/**
 * Inbound 消息处理
 * Supabase Realtime 事件 → Channel Inbound → Agent Session
 * 
 * 两种分发机制：
 * - 机制 A：api.runtime.subagent.run()（推荐用于新任务唤起）
 * - 机制 B：Channel Inbound Pipeline（用于常规消息流）
 */

import type { PluginApi } from "openclaw/plugin-sdk/channel-core";
import type { SupabaseClientManager } from "./services/supabase-client.js";
import { createObserverService, formatSessionKey, buildNewTaskMessage, buildAssignedTaskMessage, buildClientMessageMessage } from "./observer.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger('Inbound');

/**
 * Inbound 处理器
 * 负责将 Supabase 事件分发到 Agent session
 */
export interface InboundHandler {
  start(): Promise<void>;
  stop(): void;
}

/**
 * 创建 Inbound 处理器
 */
export function createInboundHandler(
  clientManager: SupabaseClientManager,
  api: PluginApi
): InboundHandler {
  let observerService: ReturnType<typeof createObserverService> | null = null;

  return {
    async start(): Promise<void> {
      const client = clientManager.getClient();
      const executorId = clientManager.getUserId();
      
      if (!client || !executorId) {
        throw new Error('Inbound handler requires authenticated client');
      }

      logger.info('启动 Inbound 处理器...');

      observerService = createObserverService(client, {
        executorId,
        
        // 新任务发现 → 通过 subagent 唤起 Agent
        async onNewTask(task) {
          const sessionKey = formatSessionKey(task.id);
          const message = buildNewTaskMessage(task);
          
          logger.info(`新任务 → 唤起 Agent [${task.id.substring(0, 8)}]`);
          
          try {
            await api.runtime.subagent.run({
              sessionKey,
              message,
              deliver: false,
            });
          } catch (error) {
            logger.error(`唤起 Agent 失败: ${(error as Error).message}`);
          }
        },

        // 中标通知 → 通过 subagent 通知 Agent
        async onTaskAssigned(task) {
          const sessionKey = formatSessionKey(task.id);
          const message = buildAssignedTaskMessage(task);
          
          logger.info(`中标通知 → 唤起 Agent [${task.id.substring(0, 8)}]`);
          
          try {
            await api.runtime.subagent.run({
              sessionKey,
              message,
              deliver: false,
            });
          } catch (error) {
            logger.error(`通知 Agent 失败: ${(error as Error).message}`);
          }
        },

        // 客户消息 → 通过 subagent 转发给 Agent
        async onNewMessage(msg) {
          const sessionKey = formatSessionKey(msg.task_id);
          const message = buildClientMessageMessage(msg);
          
          logger.info(`客户消息 → 转发 Agent [${msg.task_id.substring(0, 8)}]`);
          
          try {
            await api.runtime.subagent.run({
              sessionKey,
              message,
              deliver: false,
            });
          } catch (error) {
            logger.error(`转发消息失败: ${(error as Error).message}`);
          }
        },
      });

      await observerService.start();
      logger.info('Inbound 处理器已启动');
    },

    stop(): void {
      observerService?.stop();
      observerService = null;
      logger.info('Inbound 处理器已停止');
    },
  };
}
