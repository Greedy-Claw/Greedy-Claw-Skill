/**
 * Supabase 客户端管理服务
 * 负责认证、连接管理和 token 刷新
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GreedyClawConfig, DEFAULTS } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SupabaseClient');

export interface AuthResult {
  accessToken: string;
  userId: string;
  supabaseUrl: string;
  anonKey: string;
}

// API 响应格式（snake_case from backend）
interface AuthApiResponse {
  data: {
    access_token: string;
    user_id: string;
    supabase_url: string;
    anon_key: string;
  };
}

export interface SupabaseClientManager {
  getClient(): SupabaseClient | null;
  getAccessToken(): string | null;
  getUserId(): string | null;
  isAuthenticated(): boolean;
  authenticate(): Promise<AuthResult>;
  refreshToken(): Promise<boolean>;
}

/**
 * 创建 Supabase 客户端管理器
 */
export function createSupabaseClientManager(config: GreedyClawConfig): SupabaseClientManager {
  let client: SupabaseClient | null = null;
  let accessToken: string | null = null;
  let userId: string | null = null;
  let currentSupabaseUrl = config.supabaseUrl || DEFAULTS.supabaseUrl;
  let currentAnonKey = config.anonKey || DEFAULTS.anonKey;

  /**
   * 通过 API Gateway 认证获取 token
   */
  async function authenticate(): Promise<AuthResult> {
    const apiGatewayUrl = config.apiGatewayUrl || DEFAULTS.apiGatewayUrl;
    
    logger.auth(`正在认证... ${apiGatewayUrl}`);
    
    const response = await fetch(`${apiGatewayUrl}/auth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`认证失败: HTTP ${response.status} - ${text}`);
    }

    const json = (await response.json()) as AuthApiResponse;
    
    accessToken = json.data.access_token;
    userId = json.data.user_id;
    currentSupabaseUrl = json.data.supabase_url || currentSupabaseUrl;
    currentAnonKey = json.data.anon_key || currentAnonKey;

    // 创建 Supabase 客户端
    client = createClient(currentSupabaseUrl, currentAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
    // 关键：为 Realtime WebSocket 设置 JWT（否则会被当作 anon 角色）
    client.realtime.setAuth(accessToken!);

    logger.auth(`认证成功，用户: ${userId?.substring(0, 8)}...`);
    logger.auth(`Supabase URL: ${currentSupabaseUrl}`);

    return {
      accessToken: accessToken!,
      userId: userId!,
      supabaseUrl: currentSupabaseUrl,
      anonKey: currentAnonKey,
    };
  }

  /**
   * 刷新 token
   */
  async function refreshToken(): Promise<boolean> {
    try {
      const apiGatewayUrl = config.apiGatewayUrl || DEFAULTS.apiGatewayUrl;
      
      logger.auth('正在刷新 token...');
      
      const response = await fetch(`${apiGatewayUrl}/auth/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.error(`刷新 token 失败: HTTP ${response.status}`);
        return false;
      }

      const json = (await response.json()) as AuthApiResponse;
      
      accessToken = json.data.access_token;
      currentSupabaseUrl = json.data.supabase_url || currentSupabaseUrl;
      currentAnonKey = json.data.anon_key || currentAnonKey;

      // 重新创建客户端
      client = createClient(currentSupabaseUrl, currentAnonKey, {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      });
      // 关键：为 Realtime WebSocket 设置 JWT
      client.realtime.setAuth(accessToken!);

      logger.auth('Token 刷新成功');
      return true;
    } catch (error) {
      logger.error(`刷新 token 异常: ${(error as Error).message}`);
      return false;
    }
  }

  return {
    getClient: () => client,
    getAccessToken: () => accessToken,
    getUserId: () => userId,
    isAuthenticated: () => client !== null && accessToken !== null,
    authenticate,
    refreshToken,
  };
}

/**
 * 带重试的认证
 */
export async function authenticateWithRetry(
  manager: SupabaseClientManager,
  maxRetries: number = 5,
  retryDelayMs: number = 5000
): Promise<AuthResult> {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      return await manager.authenticate();
    } catch (error) {
      retries++;
      logger.error(`认证失败 ${retries}/${maxRetries}: ${(error as Error).message}`);
      
      if (retries >= maxRetries) {
        throw new Error(`认证失败超过 ${maxRetries} 次`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  
  throw new Error('认证失败');
}
