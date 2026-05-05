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

const DEFAULT_API_GATEWAY_URL = "https://api.greedyclaw.com/api-gateway";

export interface AuthConfig {
  /** API Key（sk_live_xxx 格式） */
  apiKey: string;
  /** API Gateway URL（默认: https://api.greedyclaw.com/api-gateway） */
  apiGatewayUrl?: string;
}

export interface AuthSession {
  /** JWT access token */
  accessToken: string;
  /** 用户 ID（即 executor_id） */
  userId: string;
  /** 过期时间戳（秒） */
  expiresAt: number;
}

export class AuthManager {
  private config: AuthConfig;
  private session: AuthSession | null = null;
  private supabaseClient: SupabaseClient | null = null;

  private gatewayUrl: string;

  constructor(config: AuthConfig) {
    this.config = config;
    this.gatewayUrl = config.apiGatewayUrl || DEFAULT_API_GATEWAY_URL;
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
      const response = await fetch(`${this.gatewayUrl}/auth/token`, {
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

    const { access_token, user_id, expires_in, supabase_url, anon_key } = result.data;

    if (!access_token || !user_id) {
      throw new Error('API Gateway 返回的 JWT 数据不完整');
    }

    if (!supabase_url || !anon_key) {
      throw new Error('API Gateway 返回的连接信息不完整（缺少 supabase_url 或 anon_key）');
    }

    this.session = {
      accessToken: access_token,
      userId: user_id,
      expiresAt: Math.floor(Date.now() / 1000) + (expires_in || 3600),
    };

    if (this.supabaseClient) {
      // 已有 client：只需更新 session 中的 accessToken
      this.supabaseClient.realtime.setAuth(access_token);
      console.log(`[AUTH] Token 已更新（复用现有 Supabase Client）`);
    } else {
      // 首次认证：用 API Gateway 返回的 supabase_url 和 anon_key 创建 Client
      this.supabaseClient = createClient(supabase_url, anon_key, {
        accessToken: async () => this.session?.accessToken ?? '',
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        realtime: {
          accessToken: async () => this.session?.accessToken ?? '',
        },
      });
    }

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
   * @returns true 表示进行了刷新，false 表示无需刷新
   */
  async refreshIfNeeded(): Promise<boolean> {
    if (this.isSessionExpiring()) {
      console.log('[AUTH] Session 即将过期，正在刷新...');
      await this.authenticate();
      return true;
    }
    return false;
  }
}