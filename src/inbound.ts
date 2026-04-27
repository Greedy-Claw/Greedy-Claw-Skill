/**
 * Inbound 消息处理
 * Supabase Realtime 事件 → OpenClaw Inbound Pipeline
 */

import { createObserverService, buildNewTaskMessage, buildAssignedTaskMessage, buildClientMessageMessage } from "./observer.js";
import { createLogger } from "./utils/logger.js";
import type { PluginApi, InboundEnvelope } from "openclaw/plugin-sdk/channel-core";

const logger = createLogger('Inbound');

function createEnvelope(
  conversationId: string,
  senderId: string | null,
  content: string,
  eventType: 'new_task' | 'task_assigned' | 'new_message'
): InboundEnvelope {
  return {
    channelId: 'greedyclaw',
    conversationId,
    rawId: conversationId,
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
 * @param accessToken JWT token for Realtime auth
 * @param supabaseUrl Supabase URL
 * @param anonKey Supabase anon key
 * @param executorId Current executor ID
 * @param api Plugin API
 */
export function createInboundHandler(
  accessToken: string,
  supabaseUrl: string,
  anonKey: string,
  executorId: string,
  api: PluginApi
) {
  let observerService: ReturnType<typeof createObserverService> | null = null;

  return {
    async start(): Promise<void> {
      logger.info('启动 Inbound 处理器...');

      observerService = createObserverService(accessToken, {
        supabaseUrl,
        anonKey,
        executorId,

        async onNewTask(task) {
          logger.info(`新任务 [${task.id.substring(0, 8)}]`);
          const message = buildNewTaskMessage(task);
          try {
            if (api.runtime?.channel?.dispatchInbound) {
              await api.runtime.channel.dispatchInbound(createEnvelope(task.id, null, message, 'new_task'));
            } else if (api.runtime?.subagent?.run) {
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

        async onTaskAssigned(task) {
          logger.info(`中标 [${task.id.substring(0, 8)}]`);
          const message = buildAssignedTaskMessage(task);
          try {
            if (api.runtime?.channel?.dispatchInbound) {
              await api.runtime.channel.dispatchInbound(createEnvelope(task.id, null, message, 'task_assigned'));
            } else if (api.runtime?.subagent?.run) {
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

        async onNewMessage(msg) {
          logger.info(`客户消息 [bid: ${msg.bid_id.substring(0, 8)}]: ${msg.content?.substring(0, 30)}`);
          const message = buildClientMessageMessage(msg);
          try {
            if (api.runtime?.channel?.dispatchInbound) {
              await api.runtime.channel.dispatchInbound(createEnvelope(msg.bid_id, msg.sender_id, message, 'new_message'));
            } else if (api.runtime?.subagent?.run) {
              await api.runtime.subagent.run({
                sessionKey: `agent:main:greedyclaw:bid:${msg.bid_id}`,
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
