/**
 * GreedyClaw Channel Plugin 对象
 *
 * 定义 Channel 的 setup、security、threading、outbound、gateway 等适配器。
 * 消息注入通过 runtime.channel.turn.run 走平台核心管道。
 *
 * v4 变化：
 * - 新增 gateway.startAccount / stopAccount（参考 Weixin）
 * - 不再使用 sidecar 子进程
 * - Monitor 生命周期由 startAccount/stopAccount 管理
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";

// ========================================
// 运行时状态跟踪
// ========================================
const accountStates = new Map<string, {
  connected: boolean;
  running: boolean;
  lastInboundAt: number | null;
}>();

// Monitor 生命周期管理
const accountAbortControllers = new Map<string, AbortController>();

function getAccountKey(accountId: string | null): string {
  return accountId ?? "default";
}

export function markAccountConnected(accountId: string | null): void {
  const key = getAccountKey(accountId);
  const state = accountStates.get(key) || { connected: false, running: false, lastInboundAt: null };
  state.connected = true;
  state.running = true;
  accountStates.set(key, state);
}

export function markAccountDisconnected(accountId: string | null): void {
  const key = getAccountKey(accountId);
  const state = accountStates.get(key);
  if (state) {
    state.connected = false;
    state.running = false;
  }
}

export function markInboundReceived(accountId: string | null): void {
  const key = getAccountKey(accountId);
  const state = accountStates.get(key);
  if (state) {
    state.lastInboundAt = Date.now();
  }
}

export function getAccountState(accountId: string | null) {
  return accountStates.get(getAccountKey(accountId)) || null;
}

export function getAccountAbortController(accountId: string | null): AbortController | undefined {
  return accountAbortControllers.get(getAccountKey(accountId));
}

export function setAccountAbortController(accountId: string | null, controller: AbortController): void {
  accountAbortControllers.set(getAccountKey(accountId), controller);
}

export function deleteAccountAbortController(accountId: string | null): void {
  accountAbortControllers.delete(getAccountKey(accountId));
}

// ========================================
// ResolvedAccount
// ========================================
const DEFAULT_API_GATEWAY_URL = "https://api.greedyclaw.com/api-gateway";

export type ResolvedAccount = {
  accountId: string | null;
  authMode: string;
  apiKey: string;
  apiGatewayUrl: string;
};

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const section = (cfg.channels as Record<string, any>)?.["greedyclaw"];
  const pluginCfg = (cfg.plugins as any)?.entries?.greedyclaw?.config;
  const source = section || pluginCfg || {};

  return {
    accountId: accountId ?? null,
    authMode: source.authMode || "jwt",
    apiKey: source.apiKey,
    apiGatewayUrl: source.apiGatewayUrl || DEFAULT_API_GATEWAY_URL,
  };
}

// ========================================
// Channel Plugin
// ========================================
export const greedyclawPlugin = createChatChannelPlugin<ResolvedAccount>({
  base: createChannelPluginBase({
    id: "greedyclaw",
    config: {
      listAccountIds(cfg: OpenClawConfig): string[] {
        const section = (cfg.channels as Record<string, any>)?.["greedyclaw"];
        const pluginCfg = (cfg.plugins as any)?.entries?.greedyclaw?.config;
        const source = section || pluginCfg || {};
        return source.apiKey ? ["default"] : [];
      },
      resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedAccount {
        return resolveAccount(cfg, accountId);
      },
    },
    setup: {
      resolveAccount,
      inspectAccount(cfg: any, accountId?: string | null) {
        const account = resolveAccount(cfg, accountId);
        const configured = Boolean(account.apiKey);
        const state = getAccountState(accountId ?? null);

        return {
          enabled: configured,
          configured,
          connected: state?.connected ?? false,
          running: state?.running ?? false,
          lastInboundAt: state?.lastInboundAt ?? null,
          tokenStatus: account.apiKey ? "available" : "missing",
        };
      },
    },
    gateway: {
      async startAccount(account: ResolvedAccount, ctx: any) {
        const key = getAccountKey(account.accountId);
        console.log(`[GreedyClaw] gateway.startAccount: accountId=${account.accountId}`);

        // 创建或复用 AbortController
        let controller = getAccountAbortController(account.accountId);
        if (!controller || controller.signal.aborted) {
          controller = new AbortController();
          setAccountAbortController(account.accountId, controller);
        }

        // 联动 ctx.abortSignal
        if (ctx?.abortSignal && !ctx.abortSignal.aborted) {
          ctx.abortSignal.addEventListener('abort', () => controller!.abort(), { once: true });
        }

        markAccountConnected(account.accountId);
        console.log(`[GreedyClaw] gateway.startAccount: account ${key} marked as connected`);

        // startAccount 必须是长驻函数：只要 Promise 不 resolve，gateway 就认为 running
        // 返回一个在 abortSignal 触发时才 resolve 的 Promise
        return new Promise<void>((resolve) => {
          const signal = controller!.signal;
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      async stopAccount(account: ResolvedAccount, ctx: any) {
        const key = getAccountKey(account.accountId);
        console.log(`[GreedyClaw] gateway.stopAccount: accountId=${account.accountId}`);

        // 中止 monitor
        const controller = getAccountAbortController(account.accountId);
        if (controller) {
          controller.abort();
          deleteAccountAbortController(account.accountId);
        }

        markAccountDisconnected(account.accountId);
        console.log(`[GreedyClaw] gateway.stopAccount: account ${key} stopped`);
        return { stopped: true };
      },
    },
  } as any),

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
