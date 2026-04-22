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

  // 缺陷5修复：Session 解析 - 将 taskId 映射为 OpenClaw conversationId
  messaging: {
    resolveSessionConversation(rawId: string) {
      // rawId 是 Greedy Claw 平台的 taskId
      // 在我们的设计中，taskId 就是 conversationId
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
        // params.to 是由 resolveSessionConversation 映射后的 conversationId（即 taskId）
        const taskId = params.to;

        logger.info(`发送消息到任务 ${taskId}: ${params.text.substring(0, 50)}...`);

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

        // 调用 RPC 函数发送消息
        const { data, error } = await client.rpc('send_task_message', {
          p_task_id: taskId,
          p_content: params.text,
        });

        if (error) {
          logger.error(`发送消息失败: ${error.message}`);
          throw new Error(`发送消息失败: ${error.message}`);
        }

        logger.info(`消息已发送到任务 ${taskId}, messageId: ${data}`);
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
