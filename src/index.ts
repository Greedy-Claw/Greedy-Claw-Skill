/**
 * GreedyClaw Channel Plugin Entry — In-Process 架构
 *
 * 架构（v3 → v4）：
 * - 去掉 sidecar 子进程，所有逻辑在主进程内运行
 * - Realtime 监听 + 心跳 + JWT 刷新通过 monitor 长驻函数管理
 * - 工具调用直接走 Supabase client，无 HTTP 中转
 * - Monitor 生命周期由 startAccount/stopAccount 管理
 */

import { randomUUID } from 'crypto';
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import {
  greedyclawPlugin,
  markAccountConnected, markAccountDisconnected, markInboundReceived,
  getAccountAbortController, setAccountAbortController, deleteAccountAbortController,
} from "./channel.js";
import { createTools } from "./tools.js";
import { initializeSupabase, monitorGreedyClaw } from "./monitor.js";
import type { EventData } from "./monitor.js";
import {
  setSupabase, setAuthManager, setExecutorId,
  getSupabase, getAuthManager, getExecutorId,
} from "./state.js";

// ========================================
// 类型
// ========================================
interface PluginConfig {
  baseUrl: string;
  apiKey: string;
  supabaseKey: string;
  apiGatewayUrl: string;
  sidecarPort?: number;  // 保留字段兼容旧配置，但不再使用
  pluginPort?: number;   // 保留字段兼容旧配置，但不再使用
}

// ========================================
// Runtime Store
// ========================================
const runtimeStore = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "greedyclaw",
  errorMessage: "GreedyClaw runtime not initialized",
});

// ========================================
// 事件格式化
// ========================================
function formatEvent(type: string, data: EventData): string {
  const taskKey = data.task_id || data.id;
  const details: string[] = [];

  switch (type) {
    case 'new_task':
      details.push(`新任务发布`);
      if (data.instruction) details.push(`指令: ${data.instruction}`);
      break;
    case 'bid_status_changed':
      details.push(`竞标状态变更`);
      if (data.bid_id) details.push(`竞标 ID: ${data.bid_id}`);
      if (data.status) details.push(`新状态: ${data.status}`);
      break;
    case 'new_message':
      details.push(`收到新消息`);
      if (data.content) details.push(`内容: ${data.content}`);
      if (data.sender_id) details.push(`发送者: ${data.sender_id}`);
      break;
    default:
      details.push(`类型: ${type}`);
  }

  details.push(`任务 ID: ${taskKey}`);

  return `[GreedyClaw 事件] ${details.join(' | ')}\n\n请根据 GreedyClaw 插件的 SKILL.md 检查并响应此事件。`;
}

// ========================================
// Monitor 启动逻辑（由 startAccount 调用）
// ========================================
async function startMonitor(accountId: string | null, config: PluginConfig): Promise<void> {
  console.log(`[GreedyClaw] startMonitor: initializing for accountId=${accountId}...`);

  // 初始化 Supabase（仅 JWT 模式）
  try {
    await initializeSupabase({
      apiKey: config.apiKey,
      apiGatewayUrl: config.apiGatewayUrl,
      supabaseUrl: config.baseUrl,
      supabaseKey: config.supabaseKey,
    });
  } catch (err) {
    console.error('[GreedyClaw] Supabase 初始化失败:', err);
    markAccountDisconnected(accountId);
    return;
  }

  console.log(`[GreedyClaw] Supabase 初始化完成, executorId=${getExecutorId() || 'anonymous'}`);

  // 获取 AbortController
  const controller = getAccountAbortController(accountId);
  if (!controller || controller.signal.aborted) {
    console.warn('[GreedyClaw] AbortController 不可用或已中止，Monitor 无法启动');
    markAccountDisconnected(accountId);
    return;
  }

  // 获取 channelRuntime
  try {
    runtimeStore.getRuntime();
  } catch (err) {
    console.error('[GreedyClaw] 获取 channelRuntime 失败:', err);
    markAccountDisconnected(accountId);
    return;
  }

  // 定义事件回调 — Realtime 事件 → channel.turn.run 注入
  const onEvent = async (type: string, data: EventData) => {
    const taskKey = data.task_id || data.id;
    const text = formatEvent(type, data);

    console.log(`[GreedyClaw] Received event: ${type}, task=${taskKey}`);

    // 更新入站时间戳
    markInboundReceived(accountId);

    try {
      const runtime = runtimeStore.getRuntime();
      const routeSessionKey = `agent:main:channel:greedyclaw:task:${taskKey}`;

      const ctxPayload = runtime.channel.turn.buildContext({
        channel: "greedyclaw",
        accountId: null,
        timestamp: Date.now(),
        from: `greedyclaw:${data.sender_id || "system"}`,
        sender: {
          id: data.sender_id || "greedyclaw-system",
          name: "GreedyClaw",
          isBot: true,
          isSelf: false,
          displayLabel: "GreedyClaw",
        },
        conversation: {
          kind: "direct",
          id: `task:${taskKey}`,
        },
        route: {
          agentId: "main",
          accountId: null,
          routeSessionKey,
        },
        reply: {
          to: `greedyclaw:task:${taskKey}`,
        },
        message: {
          rawBody: text,
          bodyForAgent: text,
        },
        access: {
          mentions: { wasMentioned: true },
        },
      });

      await runtime.channel.turn.run({
        channel: "greedyclaw",
        accountId: null,
        raw: { type, data },
        adapter: {
          ingest(raw) {
            return {
              id: data.id || randomUUID(),
              timestamp: Date.now(),
              rawText: text,
              textForAgent: text,
              textForCommands: text,
            };
          },
          classify(input) {
            return { kind: "message", canStartAgentTurn: true };
          },
          resolveTurn(input) {
            const noopDispatcher = {
              sendToolResult: () => false,
              sendBlockReply: () => false,
              sendFinalReply: () => false,
              waitForIdle: async () => {},
              getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
              getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
              markComplete: () => {},
            };

            return {
              channel: "greedyclaw",
              accountId: null,
              routeSessionKey,
              storePath: runtime.channel.session?.resolveStorePath?.(
                runtime.config?.session?.store,
                { agentId: "main" },
              ),
              ctxPayload,
              recordInboundSession: runtime.channel.session?.recordInboundSession,
              record: { createIfMissing: true },
              runDispatch: () => runtime.channel.reply!.withReplyDispatcher({
                dispatcher: noopDispatcher,
                run: () => runtime.channel.reply!.dispatchReplyFromConfig({
                  ctx: ctxPayload,
                  cfg: runtime.config,
                  dispatcher: noopDispatcher,
                }),
              }),
              sender: {
                id: data.sender_id || "greedyclaw-system",
                name: "GreedyClaw",
                isBot: true,
                isSelf: false,
                displayLabel: "GreedyClaw",
              },
              conversation: {
                kind: "direct",
                id: `task:${taskKey}`,
              },
              route: {
                agentId: "main",
                routeSessionKey,
                createIfMissing: true,
              },
              reply: {
                to: `greedyclaw:task:${taskKey}`,
              },
              message: {
                body: text,
                rawBody: text,
                bodyForAgent: text,
              },
              access: {
                dm: { policy: "allow" },
                group: { allowed: true },
                commands: { authorized: true },
                mentions: { wasMentioned: true },
              },
              delivery: {
                deliver: async (_payload: any, _info: any) => {
                  return { visibleReplySent: false };
                },
              },
            };
          },
        },
      });

      console.log(`[GreedyClaw] Event processed: ${type}, task=${taskKey}`);
    } catch (err: any) {
      console.error(`[GreedyClaw] Channel turn error:`, err);
    }
  };

  // 启动 monitor
  monitorGreedyClaw({ onEvent, abortSignal: controller.signal }).then(() => {
    // monitor 正常退出
    if (!controller.signal.aborted) {
      console.log('[GreedyClaw] Monitor exited unexpectedly, marking disconnected');
      markAccountDisconnected(accountId);
    }
  }).catch((err) => {
    if (!controller.signal.aborted) {
      console.error('[GreedyClaw] Monitor crashed:', err);
    }
    markAccountDisconnected(accountId);
  });

  console.log('[GreedyClaw] Monitor 已在后台启动');
}

// ========================================
// Channel Plugin Entry
// ========================================
export default defineChannelPluginEntry({
  id: "greedyclaw",
  name: "GreedyClaw",
  description: "在线接单平台智能竞标助手",
  plugin: greedyclawPlugin,
  setRuntime: runtimeStore.setRuntime,

  registerFull(api) {
    const config = api.pluginConfig as PluginConfig;

    // ========================================
    // 1. 注册工具
    // ========================================
    const tools = createTools();
    for (const tool of tools) {
      api.registerTool(tool, { name: tool.name });
    }
    console.log(`[GreedyClaw] Registered ${tools.length} tools`);

    // ========================================
    // 2. 监听 gateway_start 启动 Monitor
    //    gateway_start 没有 abortSignal，自建 AbortController
    // ========================================
    api.on('gateway_start', async (ctx: any) => {
      console.log('[GreedyClaw] Gateway starting, initializing in-process monitor...');

      // 自建 AbortController（startAccount 可能还没被调用）
      const controller = new AbortController();
      setAccountAbortController(null, controller);

      // 如果 ctx 有 abortSignal，联动
      if (ctx?.abortSignal && !ctx.abortSignal.aborted) {
        ctx.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      await startMonitor(null, config);
    });
  },
});
