/**
 * Greedy Claw Channel Plugin 定义
 * 使用 createChatChannelPlugin 创建 Channel Plugin
 *
 * 修复记录：
 * - 缺陷2: outbound.sendText 实现为真正的消息发送（通过 RPC send_task_message）
 * - 缺陷5: 添加 messaging.resolveSessionConversation 将 taskId 映射为 conversationId
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
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
 * 优先从 plugins.entries.greedyclaw.config 读取，兼容旧路径 channels.greedyclaw
 */
function getSection(cfg: OpenClawConfig): GreedyClawSection {
    // cfg 是 OpenClawConfig API 对象，需要调用 loadConfig() 获取实际配置
    let actualConfig = cfg as Record<string, unknown>;
    if (typeof (cfg as Record<string, unknown>)?.loadConfig === 'function') {
        try {
            actualConfig = (cfg as { loadConfig: () => Record<string, unknown> }).loadConfig();
        } catch {
            // 忽略错误，使用原始 cfg
        }
    }
    // 优先从 plugins.entries.greedyclaw.config 读取
    const plugins = actualConfig.plugins as { entries?: Record<string, { config?: GreedyClawSection }> } | undefined;
    const pluginConfig = plugins?.entries?.greedyclaw?.config;
    if (pluginConfig) {
        return pluginConfig;
    }
    // 兼容旧配置路径 channels.greedyclaw
    const channels = actualConfig.channels as Record<string, GreedyClawSection> | undefined;
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
  const apiKey = section.apiKey || '';
  
  return {
    accountId: accountId ?? null,
    apiKey,
    supabaseUrl: section.supabaseUrl || '',
    anonKey: section.anonKey || '',
    apiGatewayUrl: section.apiGatewayUrl || '',
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

  // 缺陷5修复：Session 解析 - 将 bidId 映射为 OpenClaw conversationId
  messaging: {
    resolveSessionConversation(rawId: string) {
      // rawId 是 Greedy Claw 平台的 bidId
      // 在我们的设计中，bidId 就是 conversationId
      return {
        conversationId: rawId,
        threadId: null,
        baseConversationId: rawId,
        parentConversationCandidates: [],
      };
    },
  },

  // 缺陷2修复：Outbound - Agent → Greedy Claw 平台消息发送
  // 当 Agent 使用核心共享的 message tool 发送消息时，OpenClaw 调用此方法
  outbound: {
    attachedResults: {
      sendText: async (params: { to: string; text: string }) => {
        // params.to 是由 resolveSessionConversation 映射后的 conversationId（即 bidId）
        const bidId = params.to;

        logger.info(`发送消息到 bid ${bidId}: ${params.text.substring(0, 50)}...`);

        // 通过 runtimeStore 获取当前账户的 Supabase 客户端
        // 注意：runtimeStore 在 index.ts 中创建并设置
        const { getRuntimeStore } = await import('./runtime-store.js');
        const runtimeStore = getRuntimeStore();
        
        if (!runtimeStore.hasRuntime()) {
          throw new Error('Runtime 未初始化，无法发送消息');
        }

        const runtime = runtimeStore.getRuntime();
        const account = resolveAccount(runtime.config);

        // 认证获取 Supabase 客户端
        const { createSupabaseClientManager } = await import('./services/supabase-client.js');
        const clientManager = createSupabaseClientManager({
          apiKey: account.apiKey,
          supabaseUrl: account.supabaseUrl,
          anonKey: account.anonKey,
          apiGatewayUrl: account.apiGatewayUrl,
        });

        await clientManager.authenticate();
        const client = clientManager.getClient();

        if (!client) {
          throw new Error('认证失败：无法获取 Supabase 客户端');
        }

        // 调用 RPC 函数发送消息 (bids_messages)
        const { data, error } = await client.rpc('send_bid_message', {
          p_bid_id: bidId,
          p_content: params.text,
        });

        if (error) {
          logger.error(`发送消息失败: ${error.message}`);
          throw new Error(`发送消息失败: ${error.message}`);
        }

        logger.info(`消息已发送到 bid ${bidId}, messageId: ${data}`);
        return { messageId: String(data) };
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
