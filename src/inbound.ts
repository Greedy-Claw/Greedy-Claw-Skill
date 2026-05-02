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
      logger.info(`收到 Webhook 请求: ${req.method || '未知方法'} ${req.url || '未知路径'}`);
      
      // 解析请求体 - 支持多种请求格式
      let body: WebhookEvent | undefined;
      
      // 尝试从不同来源获取请求体
      if (req.body) {
        logger.debug(`req.body 类型: ${typeof req.body}`);
        if (typeof req.body === 'string') {
          try {
            body = JSON.parse(req.body);
          } catch (parseError) {
            logger.error(`JSON 解析失败: ${(parseError as Error).message}`);
            if (res && typeof res.status === 'function') {
              res.status(400).json({ error: 'Invalid JSON' });
            }
            return false;
          }
        } else {
          body = req.body;
        }
      } else if (req.rawBody) {
        // 某些框架会将原始请求体放在 rawBody 中
        try {
          body = JSON.parse(req.rawBody);
          logger.debug('从 rawBody 解析成功');
        } catch (parseError) {
          logger.error(`rawBody JSON 解析失败: ${(parseError as Error).message}`);
        }
      } else if (req.payload) {
        // Hapi 风格
        body = typeof req.payload === 'string' ? JSON.parse(req.payload) : req.payload;
        logger.debug('从 payload 解析成功');
      }

      // 如果还是没有 body，尝试从请求流读取（异步处理已在中间件层完成）
      if (!body) {
        logger.error(`无法获取请求体，req 对象键: ${Object.keys(req).join(', ')}`);
        if (res && typeof res.status === 'function') {
          res.status(400).json({ error: 'Missing request body' });
        }
        return false;
      }

      // 验证请求体
      if (!body.type) {
        logger.error(`无效的请求体 - 缺少 type 字段: ${JSON.stringify(body).substring(0, 200)}`);
        if (res && typeof res.status === 'function') {
          res.status(400).json({ error: 'Missing type field in request body' });
        }
        return false;
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
 * Runtime API 接口
 * 用于直接调用 runtime 方法而不通过 HTTP webhook
 */
export interface RuntimeApi {
  dispatchInbound?: (envelope: InboundEnvelope) => Promise<void>;
  subagentRun?: (params: { sessionKey: string; message: string; deliver?: boolean }) => Promise<{ result: unknown }>;
}

/**
 * 创建 Inbound 处理器
 * @param accessToken JWT token for Realtime auth
 * @param supabaseUrl Supabase URL
 * @param anonKey Supabase anon key
 * @param executorId Current executor ID
 * @param webhookUrl 内部 webhook URL（备用）
 * @param runtimeApi 可选的 Runtime API（优先使用直接调用）
 */
export function createInboundHandler(
  accessToken: string,
  supabaseUrl: string,
  anonKey: string,
  executorId: string,
  webhookUrl: string,
  runtimeApi?: RuntimeApi
) {
  let observerService: ReturnType<typeof createObserverService> | null = null;

  /**
   * 处理事件 - 优先使用直接 runtime 调用，失败时回退到 HTTP webhook
   */
  async function dispatchEvent(
    type: 'new_task' | 'task_assigned' | 'new_message',
    conversationId: string,
    senderId: string | null,
    message: string
  ): Promise<boolean> {
    // 优先使用直接 runtime API 调用
    if (runtimeApi?.dispatchInbound) {
      try {
        await runtimeApi.dispatchInbound(createEnvelope(conversationId, senderId, message, type));
        logger.info(`事件 ${type} 已通过 dispatchInbound 分发`);
        return true;
      } catch (error) {
        logger.error(`dispatchInbound 失败: ${(error as Error).message}，尝试 webhook 回退`);
      }
    }

    if (runtimeApi?.subagentRun) {
      try {
        const sessionKey = type === 'new_message'
          ? `agent:main:greedyclaw:bid:${conversationId}`
          : `agent:main:greedyclaw:task:${conversationId}`;
        await runtimeApi.subagentRun({ sessionKey, message, deliver: false });
        logger.info(`事件 ${type} 已通过 subagentRun 处理`);
        return true;
      } catch (error) {
        logger.error(`subagentRun 失败: ${(error as Error).message}，尝试 webhook 回退`);
      }
    }

    // 回退到 HTTP webhook
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          payload: { 
            taskId: type !== 'new_message' ? conversationId : undefined,
            bidId: type === 'new_message' ? conversationId : undefined,
            senderId,
            data: { id: conversationId }
          }
        } as WebhookEvent),
      });
      if (response.ok) {
        logger.info(`事件 ${type} 已通过 webhook 分发`);
        return true;
      } else {
        logger.error(`Webhook 调用失败: HTTP ${response.status}`);
        return false;
      }
    } catch (error) {
      logger.error(`Webhook 调用失败: ${(error as Error).message}`);
      return false;
    }
  }

  return {
    async start(): Promise<void> {
      logger.info('启动 Inbound 处理器...');
      logger.info(`Webhook URL: ${webhookUrl}`);
      logger.info(`Runtime API 可用: dispatchInbound=${!!runtimeApi?.dispatchInbound}, subagentRun=${!!runtimeApi?.subagentRun}`);

      observerService = createObserverService(accessToken, {
        supabaseUrl,
        anonKey,
        executorId,

        async onNewTask(task) {
          const message = buildNewTaskMessage(task);
          logger.info(`新任务: [${task.id.substring(0, 8)}] ${task.instruction?.substring(0, 30)}`);
          await dispatchEvent('new_task', task.id, null, message);
        },

        async onTaskAssigned(task) {
          const message = buildAssignedTaskMessage(task);
          logger.info(`中标: [${task.id.substring(0, 8)}]`);
          await dispatchEvent('task_assigned', task.id, null, message);
        },

        async onNewMessage(msg) {
          const message = buildClientMessageMessage(msg);
          logger.info(`新消息 [bid: ${msg.bid_id.substring(0, 8)}]: ${msg.content?.substring(0, 30)}`);
          await dispatchEvent('new_message', msg.bid_id, msg.sender_id, message);
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
