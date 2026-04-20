/**
 * Greedy Claw Channel Plugin 定义
 * 使用 createChatChannelPlugin 创建 Channel Plugin
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { DEFAULTS } from "./utils/config.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger('Channel');

/**
 * Greedy Claw 配置段
 */
interface GreedyClawSection {
  apiKey?: string;
  supabaseUrl?: string;
  anonKey?: string;
  apiGatewayUrl?: string;
}

/**
 * 解析后的账户信息
 */
export type ResolvedAccount = {
  accountId: string | null;
  apiKey: string;
  supabaseUrl: string;
  anonKey: string;
  apiGatewayUrl: string;
};

/**
 * 从配置中获取 GreedyClaw section
 */
function getSection(cfg: OpenClawConfig): GreedyClawSection {
  const channels = cfg.channels as Record<string, GreedyClawSection> | undefined;
  return channels?.["greedyclaw"] ?? {};
}

/**
 * 从 OpenClaw 配置解析账户
 */
function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const section = getSection(cfg);
  const apiKey = section.apiKey;
  
  if (!apiKey) {
    throw new Error("greedyclaw: apiKey is required");
  }
  
  return {
    accountId: accountId ?? null,
    apiKey,
    supabaseUrl: section.supabaseUrl || DEFAULTS.supabaseUrl,
    anonKey: section.anonKey || DEFAULTS.anonKey,
    apiGatewayUrl: section.apiGatewayUrl || DEFAULTS.apiGatewayUrl,
  };
}

/**
 * Greedy Claw Channel Plugin
 */
export const greedyclawPlugin = createChatChannelPlugin<ResolvedAccount>({
  base: createChannelPluginBase({
    id: "greedyclaw",
    setup: {
      resolveAccount,
      inspectAccount(cfg: OpenClawConfig, _accountId?: string | null) {
        const section = getSection(cfg);
        return {
          enabled: Boolean(section.apiKey),
          configured: Boolean(section.apiKey),
          tokenStatus: section.apiKey ? "available" : "missing",
        };
      },
    },
  }),

  // DM 安全策略：Greedy Claw 任务市场为开放模式
  security: {
    dm: {
      channelKey: "greedyclaw",
      resolvePolicy: () => "open",
      resolveAllowFrom: () => [],
      defaultPolicy: "open",
    },
  },

  // 线程模式：每个任务一个顶层对话
  threading: { topLevelReplyToMode: "reply" },

  // 出站：Agent → Greedy Claw 平台（通过 message tool）
  outbound: {
    attachedResults: {
      sendText: async (params: { to: string; text: string }) => {
        // 实际发送逻辑由 Agent 调用 greedyclaw_ask_client tool 完成
        // 此处为 Channel Plugin 的出站适配器
        logger.info(`发送消息到 ${params.to}: ${params.text.substring(0, 50)}...`);
        return { messageId: `msg-${Date.now()}` };
      },
    },
  },
});

/**
 * 获取账户配置
 */
export function getAccountConfig(account: ResolvedAccount): {
  supabaseUrl: string;
  anonKey: string;
  apiGatewayUrl: string;
  apiKey: string;
} {
  return {
    supabaseUrl: account.supabaseUrl,
    anonKey: account.anonKey,
    apiGatewayUrl: account.apiGatewayUrl,
    apiKey: account.apiKey,
  };
}
