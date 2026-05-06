/**
 * GreedyClaw Channel Plugin Entry — In-Process 架构
 *
 * 架构（v7 — 与飞书一致）：
 * - 去掉 sidecar 子进程，所有逻辑在主进程内运行
 * - Realtime 监听 + 心跳 + JWT 刷新通过 monitor 长驻函数管理
 * - 工具调用直接走 Supabase client，无 HTTP 中转
 * - 心跳驱动 connected 状态 + createComputedAccountStatusAdapter（与飞书一致）
 * - 采用 Weixin 风格的消息注入管道：
 *   resolveAgentRoute → finalizeInboundContext → recordInboundSession → dispatchReplyFromConfig
 *
 * 启动路径（与飞书一致）：
 * - 框架调用 gateway.startAccount() → startMonitor() → monitorGreedyClaw() 长驻
 * - startAccount 直接返回 startMonitor() Promise，框架据此判断 running 状态
 * - 移除 gateway_start 事件，生命周期完全由框架 gateway 管理
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import {
  greedyclawPlugin,
  markAccountConnected, markAccountDisconnected, markInboundReceived,
} from "./channel.js";
import { createTools } from "./tools.js";
import { initializeSupabase, monitorGreedyClaw } from "./monitor.js";
import type { EventData } from "./monitor.js";
import {
  setSupabase, setAuthManager, setExecutorId,
  getSupabase, getAuthManager, getExecutorId,
  runtimeStore,
} from "./state.js";
import { getLogger } from "./logger.js";

// ========================================
// 类型
// ========================================
interface PluginConfig {
  apiKey: string;
  apiGatewayUrl?: string;
  sidecarPort?: number;  // 保留字段兼容旧配置，但不再使用
  pluginPort?: number;   // 保留字段兼容旧配置，但不再使用
}

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
// Monitor 启动逻辑（与飞书 monitorFeishuProvider 一致）
// ========================================
function resolvePluginConfig(cfg: any): PluginConfig {
  const section = (cfg.channels as Record<string, any>)?.["greedyclaw"];
  const pluginCfg = (cfg.plugins as any)?.entries?.greedyclaw?.config;
  const source = section || pluginCfg || {};
  return {
    apiKey: source.apiKey ?? "",
    apiGatewayUrl: source.apiGatewayUrl,
  };
}

export async function startMonitor(
  accountId: string | null,
  cfg: any,
  abortSignal: AbortSignal,
  setStatus?: (patch: any) => void,
): Promise<void> {
  const config = resolvePluginConfig(cfg);

  getLogger().info(`startMonitor: initializing for accountId=${accountId}...`);

  // 初始化 Supabase（仅 JWT 模式）
  try {
    await initializeSupabase({
      apiKey: config.apiKey,
      apiGatewayUrl: config.apiGatewayUrl,
    });
  } catch (err) {
    getLogger().error('Supabase 初始化失败:', { error: String(err) });
    markAccountDisconnected(accountId);
    throw err; // 抛出让框架记录 lastError
  }

  getLogger().info(`Supabase 初始化完成, executorId=${getExecutorId() || 'anonymous'}`);

  // 检查 channelRuntime 是否可用
  try {
    runtimeStore.getRuntime();
  } catch (err) {
    getLogger().error('获取 channelRuntime 失败:', { error: String(err) });
    markAccountDisconnected(accountId);
    throw err;
  }

  // 心跳回调：更新插件本地状态（框架 runtime store 由 onConnectionChange 管理）
  const onHeartbeatResult = (ok: boolean) => {
    if (ok) {
      markAccountConnected(accountId);
    } else {
      markAccountDisconnected(accountId);
    }
  };

  // 连接状态变更回调 — 同步更新框架 runtime store
  // 由 Realtime 订阅就绪 / 心跳成功 / 断开 触发
  const onConnectionChange = (connected: boolean) => {
    if (connected) {
      setStatus?.({
        accountId: accountId ?? "default",
        connected: true,
        lastConnectedAt: Date.now(),
      });
    } else {
      setStatus?.({
        accountId: accountId ?? "default",
        connected: false,
      });
    }
  };

  // 定义事件回调 — Realtime 事件 → 高级管道注入
  // 采用 Weixin 风格: resolveAgentRoute → finalizeInboundContext → recordInboundSession → dispatchReplyFromConfig
  const onEvent = async (type: string, data: EventData) => {
    const taskKey = data.task_id || data.id;
    const text = formatEvent(type, data);

    getLogger().info(`Received event: ${type}, task=${taskKey}`);

    // 更新入站时间戳（本地 + 框架 runtime store）
    const now = Date.now();
    markInboundReceived(accountId);
    setStatus?.({
      accountId: accountId ?? "default",
      lastInboundAt: now,
    });

    try {
      const runtime = runtimeStore.getRuntime();
      const channelRuntime = runtime.channel;
      const cfg = typeof runtime.config?.current === "function" ? runtime.config.current() : runtime.config;

      // 1. 通过框架 API 解析路由 — peer.kind="group" 确保每个 task 独立 session（与飞书一致）
      const route = channelRuntime.routing.resolveAgentRoute({
        cfg,
        channel: "greedyclaw",
        accountId: null,
        peer: { kind: "group", id: `task:${taskKey}` },
      });

      getLogger().info(`Route resolved: agentId=${route.agentId} sessionKey=${route.sessionKey}`);

      // 2. 构建入站上下文
      const ctx: Record<string, any> = {
        Channel: "greedyclaw",
        AccountId: null,
        Timestamp: Date.now(),
        From: `greedyclaw:${data.sender_id || "system"}`,
        To: `greedyclaw:task:${taskKey}`,
        Body: text,
        BodyForAgent: text,
        RawBody: text,
        CommandBody: text,
        CommandAuthorized: true,
        SessionKey: route.sessionKey,

        ChatType: "group",
        SenderId: data.sender_id || "greedyclaw-system",
        SenderName: "GreedyClaw",
        Conversation: {
          kind: "group",
          id: `task:${taskKey}`,
        },
        Route: {
          agentId: route.agentId,
          sessionKey: route.sessionKey,
        },
        Reply: {
          to: `greedyclaw:task:${taskKey}`,
        },
        Access: {
          dm: { policy: "allow" },
          group: { allowed: true },
          commands: { authorized: true },
          mentions: { wasMentioned: true },
        },
      };

      // 3. finalizeInboundContext — 框架标准化上下文
      const finalized = channelRuntime.reply.finalizeInboundContext(ctx as any);

      // 4. recordInboundSession — 持久化 session 记录
      const storePath = channelRuntime.session.resolveStorePath(
        cfg?.session?.store,
        { agentId: route.agentId },
      );

      await channelRuntime.session.recordInboundSession({
        storePath,
        sessionKey: route.sessionKey,
        ctx: finalized,
        updateLastRoute: {
          sessionKey: route.mainSessionKey,
          channel: "greedyclaw",
          to: `greedyclaw:task:${taskKey}`,
          accountId: null,
        },
        onRecordError: (err: any) => {
          getLogger().error(`recordInboundSession error:`, { error: String(err) });
        },
      });

      // 5. 创建 reply dispatcher（GreedyClaw 不需要真正发送回复到外部平台）
      const noopDeliver = async (_payload: any) => {
        // GreedyClaw 是程序化通道，不需要向外部平台发送可见回复
      };

      const { dispatcher, replyOptions, markDispatchIdle } =
        channelRuntime.reply.createReplyDispatcherWithTyping({
          humanDelay: channelRuntime.reply.resolveHumanDelayConfig(cfg, route.agentId),
          typingCallbacks: {
            start: async () => {},
            stop: async () => {},
            onStartError: () => {},
            onStopError: () => {},
          },
          deliver: noopDeliver,
          onError: (err: any, info: any) => {
            getLogger().error(`Reply error (${info.kind}):`, { error: String(err) });
          },
        });

      // 6. dispatchReplyFromConfig — 触发 agent 生成回复
      try {
        await channelRuntime.reply.withReplyDispatcher({
          dispatcher,
          run: () =>
            channelRuntime.reply.dispatchReplyFromConfig({
              ctx: finalized,
              cfg,
              dispatcher,
              replyOptions: { ...replyOptions, disableBlockStreaming: true },
            }),
        });
      } finally {
        markDispatchIdle();
      }

      getLogger().info(`Event processed: ${type}, task=${taskKey}, agentId=${route.agentId}`);
    } catch (err: any) {
      getLogger().error(`Message pipeline error:`, { error: String(err) });
    }
  };

  // 启动 monitor — 返回长驻 Promise，在 abortSignal 触发时 resolve
  await monitorGreedyClaw({
    onEvent,
    abortSignal,
    onHeartbeatResult,
    onConnectionChange,
  });

  getLogger().info('Monitor 已停止');
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
    // 注册工具
    // ========================================
    const tools = createTools();
    for (const tool of tools) {
      api.registerTool(tool, { name: tool.name });
    }
    getLogger().info(`Registered ${tools.length} tools`);

    // v7: 移除 gateway_start 事件监听
    // 生命周期完全由框架 gateway.startAccount() 管理（与飞书一致）
    // startMonitor 已在 channel.ts 的 gateway.startAccount 中直接调用
  },
});
