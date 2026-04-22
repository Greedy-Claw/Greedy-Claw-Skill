/**
 * Inbound 消息处理
 * Supabase Realtime 事件 → OpenClaw 标准 Inbound Pipeline
 * 
 * 修复记录：
 * - 缺陷3: 使用标准 Inbound Pipeline 替代直接调用 subagent.run()
 * - 通过 api.runtime.channel.dispatchInbound 发送标准 Envelope
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PluginApi, InboundEnvelope } from "openclaw/plugin-sdk/channel-core";
import { createObserverService, buildNewTaskMessage, buildAssignedTaskMessage, buildClientMessageMessage } from "./observer.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger('Inbound');

/**
 * Inbound 处理器
 * 负责将 Supabase 事件分发到 OpenClaw Inbound Pipeline
 */
export interface InboundHandler {
  start(): Promise<void>;
  stop(): void;
}

/**
 * 创建 Inbound Envelope
 */
function createEnvelope(
  taskId: string,
  senderId: string | null,
  content: string,
  eventType: 'new_task' | 'task_assigned' | 'new_message'
): InboundEnvelope {
  return {
    channelId: 'greedyclaw',
    conversationId: taskId,
    rawId: taskId,
    sender: {
      id: senderId || 'system',
      role: senderId ? 'user' : 'system',
    },
    content: {
      type: 'text',
      text: content,
    },
    metadata: { eventType },
  };
}

/**
 * 创建 Inbound 处理器
 */
export function createInboundHandler(
  client: SupabaseClient,
  executorId: string,
  api: PluginApi
): InboundHandler {
  let observerService: ReturnType<typeof createObserverService> | null = null;

  return {
    async start(): Promise<void> {
      logger.info('启动 Inbound 处理器...');

      observerService = createObserverService(client, {
        executorId,
        
        // 新任务发现 → 通过标准 Inbound Pipeline 分发
        async onNewTask(task) {
          logger.info(`新任务 → Inbound Pipeline [${task.id.substring(0, 8)}]`);
          
          const message = buildNewTaskMessage(task);
          const envelope = createEnvelope(task.id, null, message, 'new_task');
          
          try {
            // 使用标准 Inbound Pipeline
            if (api.runtime.channel?.dispatchInbound) {
              await api.runtime.channel.dispatchInbound(envelope);
            } else {
              // Fallback: 如果 dispatchInbound 不可用，使用 subagent.run
              logger.warn('dispatchInbound 不可用，使用 subagent.run fallback');
              await api.runtime.subagent.run({
                sessionKey: `agent:main:greedyclaw:task:${task.id}`,
                message,
                deliver: false,
              });
            }
          } catch (error) {
            logger.error(`分发新任务失败: ${(error as Error).message}`);
          }
        },

        // 中标通知 → 通过标准 Inbound Pipeline 分发
        async onTaskAssigned(task) {
          logger.info(`中标通知 → Inbound Pipeline [${task.id.substring(0, 8)}]`);
          
          const message = buildAssignedTaskMessage(task);
          const envelope = createEnvelope(task.id, null, message, 'task_assigned');
          
          try {
            if (api.runtime.channel?.dispatchInbound) {
              await api.runtime.channel.dispatchInbound(envelope);
            } else {
              logger.warn('dispatchInbound 不可用，使用 subagent.run fallback');
              await api.runtime.subagent.run({
                sessionKey: `agent:main:greedyclaw:task:${task.id}`,
                message,
                deliver: false,
              });
            }
          } catch (error) {
            logger.error(`分发中标通知失败: ${(error as Error).message}`);
          }
        },

        // 客户消息 → 通过标准 Inbound Pipeline 分发
        async onNewMessage(msg) {
          logger.info(`客户消息 → Inbound Pipeline [${msg.task_id.substring(0, 8)}]`);
          
          const message = buildClientMessageMessage(msg);
          const envelope = createEnvelope(msg.task_id, msg.sender_id, message, 'new_message');
          
          try {
            if (api.runtime.channel?.dispatchInbound) {
              await api.runtime.channel.dispatchInbound(envelope);
            } else {
              logger.warn('dispatchInbound 不可用，使用 subagent.run fallback');
              await api.runtime.subagent.run({
                sessionKey: `agent:main:greedyclaw:task:${msg.task_id}`,
                message,
                deliver: false,
              });
            }
          } catch (error) {
            logger.error(`分发客户消息失败: ${(error as Error).message}`);
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
