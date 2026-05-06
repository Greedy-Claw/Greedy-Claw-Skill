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
import { startMonitor } from "./index.js";

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
