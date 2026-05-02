/**
 * 认证管理器
 * 
 * 负责：
 * 1. 通过 API Key 调用 API Gateway 获取 JWT
 * 2. 用 JWT 创建带用户身份的 Supabase Client
 * 3. API Key 对 LLM 层隐藏，仅通过环境变量注入
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '../utils/retry.js';

export interface AuthConfig {
  /** API Key（sk_live_xxx 格式） */
  apiKey: string;
  /** API Gateway URL */
  apiGatewayUrl: string;
  /** 本地开发时的 Supabase URL 覆盖 */
  localSupabaseUrl?: string;
}

export interface AuthSession {
  /** JWT access token */
  accessToken: string;
  /** 用户 ID（即 executor_id） */
  userId: string;
  /** Supabase URL */
  supabaseUrl: string;
  /** Supabase anon key */
  anonKey: string;
  /** 过期时间戳（秒） */
  expiresAt: number;
}

export class AuthManager {
  private config: AuthConfig;
  private session: AuthSession | null = null;
  private supabaseClient: SupabaseClient | null = null;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * 获取当前 executor_id
   */
  get executorId(): string {
    if (!this.session) {
      throw new Error('尚未认证，请先调用 authenticate()');
    }
    return this.session.userId;
  }

  /**
   * 获取已认证的 Supabase Client
   */
  get client(): SupabaseClient {
    if (!this.supabaseClient) {
      throw new Error('尚未认证，请先调用 authenticate()');
    }
    return this.supabaseClient;
  }

  /**
   * 执行认证流程：API Key → JWT → Supabase Client
   */
  async authenticate(): Promise<void> {
    console.log('[AUTH] 正在通过 API Gateway 获取 JWT...');

    const result = await withRetry(async () => {
      const response = await fetch(`${this.config.apiGatewayUrl}/auth/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data: any = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    });

    const { access_token, user_id, supabase_url, anon_key, expires_in } = result.data;

    if (!access_token || !user_id) {
      throw new Error('API Gateway 返回的 JWT 数据不完整');
    }

    // 处理容器内部地址问题
    const localUrl = this.config.localSupabaseUrl || 'http://127.0.0.1:54321';
    const effectiveUrl = supabase_url?.includes('kong:8000') ? localUrl : (supabase_url || localUrl);

    this.session = {
      accessToken: access_token,
      userId: user_id,
      supabaseUrl: effectiveUrl,
      anonKey: anon_key,
      expiresAt: Math.floor(Date.now() / 1000) + (expires_in || 3600),
    };

    // 创建带用户身份的 Supabase Client
    this.supabaseClient = createClient(effectiveUrl, anon_key, {
      global: {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        accessToken: async () => access_token,
      },
    });

    console.log(`[AUTH] 认证成功! executor_id: ${user_id}`);
    console.log(`[AUTH] JWT 有效期: ${expires_in}s`);
  }

  /**
   * 检查 session 是否即将过期（预留 5 分钟缓冲）
   */
  isSessionExpiring(): boolean {
    if (!this.session) return true;
    return Date.now() / 1000 > this.session.expiresAt - 300;
  }

  /**
   * 刷新认证（重新获取 JWT）
   */
  async refreshIfNeeded(): Promise<void> {
    if (this.isSessionExpiring()) {
      console.log('[AUTH] Session 即将过期，正在刷新...');
      await this.authenticate();
    }
  }
}