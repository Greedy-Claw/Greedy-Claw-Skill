/**
 * 心跳服务
 * 定期发送心跳以获取银币奖励
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('HeartbeatService');

export interface HeartbeatService {
  start(): void;
  stop(): void;
  sendHeartbeat(): Promise<boolean>;
}

export interface HeartbeatConfig {
  intervalMs: number;
  onHeartbeatSuccess?: () => void;
  onHeartbeatFailure?: (error: Error) => void;
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  intervalMs: 60000, // 60秒
};

/**
 * 创建心跳服务
 */
export function createHeartbeatService(
  supabaseUrl: string,
  anonKey: string,
  accessToken: () => string | null,
  executorId: () => string | null,
  config: Partial<HeartbeatConfig> = {}
): HeartbeatService {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let failureCount = 0;

  /**
   * 发送心跳
   */
  async function sendHeartbeat(): Promise<boolean> {
    const token = accessToken();
    const userId = executorId();
    
    if (!token || !userId) {
      logger.error('无法发送心跳: 未认证');
      return false;
    }

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/heartbeat_buffer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': anonKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ node_id: userId }),
      });

      if (response.ok) {
        logger.heartbeat('心跳成功 +1银币');
        failureCount = 0;
        cfg.onHeartbeatSuccess?.();
        return true;
      } else {
        const text = await response.text();
        logger.error(`心跳失败: HTTP ${response.status} - ${text}`);
        failureCount++;
        cfg.onHeartbeatFailure?.(new Error(`HTTP ${response.status}`));
        return false;
      }
    } catch (error) {
      logger.error(`心跳异常: ${(error as Error).message}`);
      failureCount++;
      cfg.onHeartbeatFailure?.(error as Error);
      return false;
    }
  }

  /**
   * 启动心跳服务
   */
  function start(): void {
    if (intervalId !== null) {
      logger.warn('心跳服务已在运行');
      return;
    }

    logger.info('启动心跳服务...');
    
    // 立即发送一次心跳
    sendHeartbeat().catch(err => {
      logger.error(`初始心跳失败: ${err.message}`);
    });

    // 设置定时器
    intervalId = setInterval(async () => {
      await sendHeartbeat();
      
      // 连续失败3次后尝试刷新 token
      if (failureCount >= 3) {
        logger.warn('连续3次心跳失败，可能需要刷新 token');
        failureCount = 0;
      }
    }, cfg.intervalMs);

    logger.info(`心跳服务已启动，间隔 ${cfg.intervalMs}ms`);
  }

  /**
   * 停止心跳服务
   */
  function stop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      logger.info('心跳服务已停止');
    }
  }

  return {
    start,
    stop,
    sendHeartbeat,
  };
}
