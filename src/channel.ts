/**
 * GreedyClaw Channel Plugin 对象
 *
 * 定义 Channel 的 setup、security、threading、outbound、gateway、status 等适配器。
 * 消息注入通过 runtime.channel.turn.run 走平台核心管道。
 *
 * v7 变化（与飞书/Feishu 一致）：
 * - status 适配器使用 createComputedAccountStatusAdapter 模式
 * - gateway.startAccount 直接返回 startMonitor() 长驻 Promise（与飞书一致）
 * - 移除 gateway_start 事件，生命周期完全由框架 gateway 管理
 * - probeAccount 通过心跳新鲜度判断连接状态
 * - 不再使用 sidecar 子进程
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { initializeSupabase, monitorGreedyClaw } from "./monitor.js";
import type { EventData } from "./monitor.js";
import {
  setSupabase, setAuthManager, setExecutorId,
  getSupabase, getAuthManager, getExecutorId,
  runtimeStore,
} from "./state.js";
import { getLogger } from "./logger.js";

// ========================================
// 运行时状态跟踪（心跳驱动）
// ========================================
interface AccountState {
  connected: boolean;
  running: boolean;
  lastInboundAt: number | null;
  lastHeartbeatAt: number | null;
  lastHeartbeatOk: boolean;
}

const accountStates = new Map<string, AccountState>();

/** 心跳过期阈值：3 分钟（心跳间隔 60s，容忍连续 2 次丢失） */
const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

function getAccountKey(accountId: string | null): string {
  return accountId ?? "default";
}

function ensureState(key: string): AccountState {
  let state = accountStates.get(key);
  if (!state) {
    state = {
      connected: false,
      running: false,
      lastInboundAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatOk: false,
    };
    accountStates.set(key, state);
  }
  return state;
}

/** 心跳成功时调用 — 标记 connected + 记录心跳时间 */
export function markAccountConnected(accountId: string | null): void {
  const key = getAccountKey(accountId);
  const state = ensureState(key);
  state.connected = true;
  state.running = true;
  state.lastHeartbeatAt = Date.now();
  state.lastHeartbeatOk = true;
}

/** 心跳失败 / 断开时调用 */
export function markAccountDisconnected(accountId: string | null): void {
  const key = getAccountKey(accountId);
  const state = accountStates.get(key);
  if (state) {
    state.connected = false;
    state.running = false;
    state.lastHeartbeatOk = false;
  }
}

/** 收到入站事件时调用 */
export function markInboundReceived(accountId: string | null): void {
  const key = getAccountKey(accountId);
  const state = accountStates.get(key);
  if (state) {
    state.lastInboundAt = Date.now();
  }
}

/** 获取账户运行时状态 */
export function getAccountState(accountId: string | null): AccountState | null {
  return accountStates.get(getAccountKey(accountId)) || null;
}

/** 判断心跳是否仍然新鲜（3 分钟内有成功心跳） */
export function isHeartbeatFresh(accountId: string | null): boolean {
  const state = getAccountState(accountId);
  if (!state?.lastHeartbeatOk || !state.lastHeartbeatAt) return false;
  return (Date.now() - state.lastHeartbeatAt) < HEARTBEAT_STALE_MS;
}

// ========================================
// Probe 结果类型
// ========================================
export interface GreedyClawProbeResult {
  ok: boolean;
  error?: string;
}

// ========================================
// Status 适配器辅助函数（与飞书 createComputedAccountStatusAdapter 等价）
// ========================================
function createDefaultChannelRuntimeState(
  accountId: string,
  extra?: Record<string, unknown>,
) {
  return {
    accountId,
    running: false as const,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    ...(extra ?? {}),
  };
}

function buildProbeChannelStatusSummary(
  snapshot: {
    configured?: boolean | null;
    running?: boolean | null;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    probe?: unknown;
    lastProbeAt?: number | null;
  },
  extra?: Record<string, unknown>,
) {
  return {
    configured: snapshot.configured ?? false,
    running: snapshot.running ?? false,
    lastStartAt: snapshot.lastStartAt ?? null,
    lastStopAt: snapshot.lastStopAt ?? null,
    lastError: snapshot.lastError ?? null,
    probe: snapshot.probe,
    lastProbeAt: snapshot.lastProbeAt ?? null,
    ...(extra ?? {}),
  };
}

function buildComputedAccountStatusSnapshot(params: {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  runtime?: {
    running?: boolean | null;
    connected?: boolean | null;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
  } | null;
  probe?: unknown;
}, extra?: Record<string, unknown>) {
  const { accountId, name, enabled, configured, runtime, probe } = params;
  return {
    accountId,
    name,
    enabled,
    configured,
    running: runtime?.running ?? false,
    lastStartAt: runtime?.lastStartAt ?? null,
    lastStopAt: runtime?.lastStopAt ?? null,
    lastError: runtime?.lastError ?? null,
    probe,
    lastInboundAt: runtime?.lastInboundAt ?? null,
    lastOutboundAt: runtime?.lastOutboundAt ?? null,
    ...(typeof runtime?.connected === "boolean" ? { connected: runtime.connected } : {}),
    ...(extra ?? {}),
  };
}

/** 与飞书一致的 createComputedAccountStatusAdapter */
function createComputedAccountStatusAdapter<ResolvedAccount, Probe = unknown>(options: {
  defaultRuntime: any;
  buildChannelSummary: (params: { snapshot: any }) => any;
  probeAccount: (params: { account: ResolvedAccount; cfg: any }) => Promise<Probe>;
  resolveAccountSnapshot: (params: {
    account: ResolvedAccount;
    cfg: any;
    runtime?: any;
    probe?: Probe;
  }) => { accountId: string; enabled?: boolean; configured?: boolean; name?: string; extra?: Record<string, unknown> };
}): {
  defaultRuntime: any;
  buildChannelSummary: (params: { snapshot: any }) => any;
  probeAccount: (params: { account: ResolvedAccount; cfg: any }) => Promise<Probe>;
  buildAccountSnapshot: (params: { account: ResolvedAccount; cfg: any; runtime?: any; probe?: Probe }) => any;
} {
  return {
    defaultRuntime: options.defaultRuntime,
    buildChannelSummary: options.buildChannelSummary,
    probeAccount: options.probeAccount,
    buildAccountSnapshot: (params) => {
      const { extra, ...snapshot } = options.resolveAccountSnapshot(params);
      return buildComputedAccountStatusSnapshot(
        { ...snapshot, runtime: params.runtime, probe: params.probe },
        extra,
      );
    },
  };
}

// ========================================
// ResolvedAccount
// ========================================
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_API_GATEWAY_URL = "https://api.greedyclaw.com/api-gateway";

export type ResolvedAccount = {
  accountId: string | null;
  authMode: string;
  apiKey: string;
  apiGatewayUrl: string;
  configured: boolean;
  enabled: boolean;
};

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const section = (cfg.channels as Record<string, any>)?.["greedyclaw"];
  const pluginCfg = (cfg.plugins as any)?.entries?.greedyclaw?.config;
  const source = section || pluginCfg || {};
  const configured = Boolean(source.apiKey);

  return {
    accountId: accountId ?? null,
    authMode: source.authMode || "jwt",
    apiKey: source.apiKey,
    apiGatewayUrl: source.apiGatewayUrl || DEFAULT_API_GATEWAY_URL,
    configured,
    enabled: configured,
  };
}

// ========================================
// PluginConfig & 事件格式化 & startMonitor
// （从 index.ts 迁移至此，打破 index.ts ↔ channel.ts 循环依赖）
// ========================================
interface PluginConfig {
  apiKey: string;
  apiGatewayUrl?: string;
  sidecarPort?: number;  // 保留字段兼容旧配置，但不再使用
  pluginPort?: number;   // 保留字段兼容旧配置，但不再使用
}

function resolvePluginConfig(cfg: any): PluginConfig {
  const section = (cfg.channels as Record<string, any>)?.["greedyclaw"];
  const pluginCfg = (cfg.plugins as any)?.entries?.greedyclaw?.config;
  const source = section || pluginCfg || {};
  return {
    apiKey: source.apiKey ?? "",
    apiGatewayUrl: source.apiGatewayUrl,
  };
}

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
// Channel Plugin（与飞书结构一致）
// ========================================
export const greedyclawPlugin = createChatChannelPlugin<ResolvedAccount>({
  base: {
    ...createChannelPluginBase({
      id: "greedyclaw",
      config: {
        listAccountIds(cfg: OpenClawConfig): string[] {
          const section = (cfg.channels as Record<string, any>)?.["greedyclaw"];
          const pluginCfg = (cfg.plugins as any)?.entries?.greedyclaw?.config;
          const source = section || pluginCfg || {};
          return source.apiKey ? [DEFAULT_ACCOUNT_ID] : [];
        },
        resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedAccount {
          return resolveAccount(cfg, accountId);
        },
      },
      setup: {
        resolveAccount,
        inspectAccount(cfg: any, accountId?: string | null) {
          const account = resolveAccount(cfg, accountId);
          const fresh = isHeartbeatFresh(accountId ?? null);
          const state = getAccountState(accountId ?? null);

          return {
            enabled: account.configured,
            configured: account.configured,
            connected: fresh,
            running: state?.running ?? false,
            lastInboundAt: state?.lastInboundAt ?? null,
            tokenStatus: account.apiKey ? "available" : "missing",
          };
        },
      },
    }),

    // -------------------------------------------------------------------------
    // Status 适配器 — 使用 createComputedAccountStatusAdapter（与飞书一致）
    // createChannelPluginBase() 不处理 status/gateway 字段，
    // 它们必须与 createChannelPluginBase() 返回值同级展开
    // -------------------------------------------------------------------------
    status: createComputedAccountStatusAdapter<ResolvedAccount, GreedyClawProbeResult>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      buildChannelSummary: ({ snapshot }) =>
        buildProbeChannelStatusSummary(snapshot),
      probeAccount: async ({ account }) => {
        // 心跳驱动：3 分钟内有成功心跳则视为已连接（与飞书 probe API 验证对等）
        const fresh = isHeartbeatFresh(account.accountId ?? null);
        if (!fresh) {
          return { ok: false, error: "heartbeat stale or missing" };
        }
        return { ok: true };
      },
      resolveAccountSnapshot: ({ account, runtime }) => ({
        accountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
        enabled: account.configured,
        configured: account.configured,
        extra: {
          authMode: account.authMode,
        },
      }),
    }),

    // -------------------------------------------------------------------------
    // Gateway — 与飞书一致：startAccount 直接返回 startMonitor() 长驻 Promise
    // 框架根据 Promise 是否 resolve 判断 running 状态
    // -------------------------------------------------------------------------
    gateway: {
      async startAccount(ctx: any) {
        const accountId = ctx?.accountId ?? null;

        ctx.log?.info?.(`starting greedyclaw[${accountId}]`);

        // 通知框架账户 ID（不立即设 connected，等 Realtime/心跳确认后再标记）
        ctx.setStatus?.({
          accountId: accountId ?? DEFAULT_ACCOUNT_ID,
        });

        // 与飞书一致：直接返回 startMonitor() 的长驻 Promise
        // startMonitor 内部运行 monitorGreedyClaw()，在 abortSignal 时 resolve
        // connected 状态由 Realtime 订阅就绪 + 心跳成功驱动，通过 setStatus 同步到框架
        return startMonitor(accountId, ctx.cfg, ctx.abortSignal, ctx.setStatus);
      },
      async stopAccount(ctx: any) {
        const accountId = ctx?.accountId ?? null;
        ctx.log?.info?.(`stopping greedyclaw[${accountId}]`);
        markAccountDisconnected(accountId);
        // 通知框架 runtime store: 已断开
        ctx.setStatus?.({
          accountId: accountId ?? DEFAULT_ACCOUNT_ID,
          connected: false,
        });
        ctx.log?.info?.(`stopped greedyclaw[${accountId}]`);
        return { stopped: true };
      },
    } as any,
  } as any,

  // GreedyClaw 是程序化事件通道，使用 allow 策略
  security: {
    dm: {
      channelKey: "greedyclaw",
      resolvePolicy: () => "allow",
      resolveAllowFrom: () => [],
      defaultPolicy: "allow",
    },
  },

  // 每个 task 是独立对话，reply 模式
  threading: { topLevelReplyToMode: "reply" },

  // outbound: 不需要向外部平台发送可见回复
  outbound: {
    attachedResults: {
      sendText: async (params: any) => {
        return { messageId: `greedyclaw-${Date.now()}`, visibleReplySent: false };
      },
    },
  },
});
