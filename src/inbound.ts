/**
 * Inbound 消息处理
 * Supabase Realtime 事件 → OpenClaw Inbound Pipeline
 * 
 * 使用 HTTP Webhook 解决后台服务无法调用 runtime 方法的问题
 * 参考：https://github.com/openclaw/openclaw/blob/main/docs/plugins/sdk-channel-plugins.md
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
 * Webhook 事件类型
 */
export interface WebhookEvent {
  type: 'new_task' | 'task_assigned' | 'new_message';
  payload: {
    taskId?: string;
    bidId?: string;
    senderId?: string;
    data: any;
  };
}

/**
 * Webhook 端点路径
 */
export const WEBHOOK_PATH = '/greedyclaw/webhook';

/**
 * 创建 Webhook Handler
 * 处理来自 Observer 的 HTTP 请求
 * 
 * 参考 OpenClaw 官方文档：
 * "Your plugin needs to receive messages from the platform and forward them to OpenClaw.
 *  The typical pattern is a webhook that verifies the request and dispatches it through
 *  your channel's inbound handler."
 */
export function createWebhookHandler(api: PluginApi) {
  return async (req: any, res: any): Promise<boolean> => {
    try {
      // 解析请求体
      let body: WebhookEvent;
      if (typeof req.body === 'string') {
        body = JSON.parse(req.body);
      } else {
        body = req.body;
      }

      logger.info(`收到 Webhook 事件: ${body.type}`);

      switch (body.type) {
        case 'new_task': {
          const task = body.payload.data;
          const message = buildNewTaskMessage(task);
          logger.info(`处理新任务 [${task.id.substring(0, 8)}]`);
          
          if (api.runtime?.channel?.dispatchInbound) {
            await api.runtime.channel.dispatchInbound(createEnvelope(task.id, null, message, 'new_task'));
            logger.info(`新任务已分发到 inbound`);
          } else if (api.runtime?.subagent?.run) {
            await api.runtime.subagent.run({
              sessionKey: `agent:main:greedyclaw:task:${task.id}`,
              message,
              deliver: false,
            });
            logger.info(`新任务已通过 subagent.run 处理`);
          } else {
            logger.error('没有可用的 runtime 方法');
          }
          break;
        }

        case 'task_assigned': {
          const task = body.payload.data;
          const message = buildAssignedTaskMessage(task);
          logger.info(`处理中标通知 [${task.id.substring(0, 8)}]`);
          
          if (api.runtime?.channel?.dispatchInbound) {
            await api.runtime.channel.dispatchInbound(createEnvelope(task.id, null, message, 'task_assigned'));
          } else if (api.runtime?.subagent?.run) {
            await api.runtime.subagent.run({
              sessionKey: `agent:main:greedyclaw:task:${task.id}`,
              message,
              deliver: false,
            });
          }
          break;
        }

        case 'new_message': {
          const msg = body.payload.data;
          const message = buildClientMessageMessage(msg);
          logger.info(`处理客户消息 [bid: ${msg.bid_id.substring(0, 8)}]`);
          
          if (api.runtime?.channel?.dispatchInbound) {
            await api.runtime.channel.dispatchInbound(createEnvelope(msg.bid_id, msg.sender_id, message, 'new_message'));
          } else if (api.runtime?.subagent?.run) {
            await api.runtime.subagent.run({
              sessionKey: `agent:main:greedyclaw:bid:${msg.bid_id}`,
              message,
              deliver: false,
            });
          }
          break;
        }

        default:
          logger.warn(`未知事件类型: ${(body as any).type}`);
      }

      // 返回成功响应
      if (res && typeof res.status === 'function') {
        res.status(200).json({ success: true });
      }
      return true;

    } catch (error) {
      logger.error(`Webhook 处理失败: ${(error as Error).message}`);
      if (res && typeof res.status === 'function') {
        res.status(500).json({ error: (error as Error).message });
      }
      return false;
    }
  };
}

/**
 * 创建 Inbound 处理器
 * @param accessToken JWT token for Realtime auth
 * @param supabaseUrl Supabase URL
 * @param anonKey Supabase anon key
 * @param executorId Current executor ID
 * @param webhookUrl 内部 webhook URL（用于 Observer 调用）
 */
export function createInboundHandler(
  accessToken: string,
  supabaseUrl: string,
  anonKey: string,
  executorId: string,
  webhookUrl: string
) {
  let observerService: ReturnType<typeof createObserverService> | null = null;

  return {
    async start(): Promise<void> {
      logger.info('启动 Inbound 处理器...');
      logger.info(`Webhook URL: ${webhookUrl}`);

      observerService = createObserverService(accessToken, {
        supabaseUrl,
        anonKey,
        executorId,

        async onNewTask(task) {
          // 通过 HTTP 调用 webhook（创建 gateway request 上下文）
          try {
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'new_task',
                payload: { taskId: task.id, data: task }
              } as WebhookEvent),
            });
            if (!response.ok) {
              logger.error(`Webhook 调用失败: HTTP ${response.status}`);
            }
          } catch (error) {
            logger.error(`调用 webhook 失败: ${(error as Error).message}`);
          }
        },

        async onTaskAssigned(task) {
          try {
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'task_assigned',
                payload: { taskId: task.id, data: task }
              } as WebhookEvent),
            });
            if (!response.ok) {
              logger.error(`Webhook 调用失败: HTTP ${response.status}`);
            }
          } catch (error) {
            logger.error(`调用 webhook 失败: ${(error as Error).message}`);
          }
        },

        async onNewMessage(msg) {
          try {
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'new_message',
                payload: { bidId: msg.bid_id, senderId: msg.sender_id, data: msg }
              } as WebhookEvent),
            });
            if (!response.ok) {
              logger.error(`Webhook 调用失败: HTTP ${response.status}`);
            }
          } catch (error) {
            logger.error(`调用 webhook 失败: ${(error as Error).message}`);
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
