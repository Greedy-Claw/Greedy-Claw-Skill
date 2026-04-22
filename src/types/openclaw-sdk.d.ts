/**
 * OpenClaw Plugin SDK 类型声明
 * 这些类型由 OpenClaw 运行时提供，此处为类型存根
 *
 * 此文件为全局类型声明，不需要 import
 */

declare module "openclaw/plugin-sdk/channel-core" {
  /**
   * OpenClaw 配置对象
   */
  export interface OpenClawConfig {
    channels?: Record<string, unknown>;
    [key: string]: unknown;
  }

  /**
   * Session 解析结果
   */
  export interface SessionConversationResult {
    conversationId: string;
    threadId: string | null;
    baseConversationId: string;
    parentConversationCandidates: string[];
  }

  /**
   * Channel Plugin 基础配置
   */
  export interface ChannelPluginBase<TAccount> {
    id: string;
    setup: {
      resolveAccount(cfg: OpenClawConfig, accountId?: string | null): TAccount;
      inspectAccount(cfg: OpenClawConfig, accountId?: string | null): {
        enabled: boolean;
        configured: boolean;
        tokenStatus: "available" | "missing" | "expired";
      };
    };
  }

  /**
   * 创建 Channel Plugin 基础
   */
  export function createChannelPluginBase<TAccount>(config: {
    id: string;
    setup: {
      resolveAccount(cfg: OpenClawConfig, accountId?: string | null): TAccount;
      inspectAccount(cfg: OpenClawConfig, accountId?: string | null): {
        enabled: boolean;
        configured: boolean;
        tokenStatus: "available" | "missing" | "expired";
      };
    };
  }): ChannelPluginBase<TAccount>;

  /**
   * Chat Channel Plugin 配置
   */
  export interface ChatChannelPluginConfig<TAccount> {
    base: ChannelPluginBase<TAccount>;
    security?: {
      dm?: {
        channelKey: string;
        resolvePolicy: (account: TAccount) => string;
        resolveAllowFrom: (account: TAccount) => string[];
        defaultPolicy: string;
      };
    };
    threading?: {
      topLevelReplyToMode: "reply" | "thread";
    };
    messaging?: {
      resolveSessionConversation?: (rawId: string) => SessionConversationResult;
    };
    outbound?: {
      attachedResults?: {
        sendText?: (params: { to: string; text: string }) => Promise<{ messageId: string }>;
      };
    };
  }

  /**
   * 创建 Chat Channel Plugin
   */
  export function createChatChannelPlugin<TAccount>(
    config: ChatChannelPluginConfig<TAccount>
  ): ChatChannelPlugin<TAccount>;

  /**
   * Chat Channel Plugin 类型
   */
  export interface ChatChannelPlugin<TAccount> {
    id: string;
    setup: {
      resolveAccount(cfg: OpenClawConfig, accountId?: string | null): TAccount;
      inspectAccount(cfg: OpenClawConfig, accountId?: string | null): {
        enabled: boolean;
        configured: boolean;
        tokenStatus: "available" | "missing" | "expired";
      };
    };
  }

  /**
   * 定义 Channel Plugin 入口
   */
  export function defineChannelPluginEntry(config: {
    id: string;
    name: string;
    description: string;
    plugin: unknown;
    setRuntime?: (runtime: PluginRuntime) => void;
    registerCliMetadata?: (api: unknown) => void;
    registerFull?: (api: PluginApi) => void;
  }): unknown;

  /**
   * 定义 Setup 入口
   */
  export function defineSetupPluginEntry(plugin: unknown): unknown;

  /**
   * Plugin Runtime
   */
  export interface PluginRuntime {
    config: OpenClawConfig;
    pluginConfig: Record<string, unknown>;
  }

  /**
   * Plugin API
   */
  export interface PluginApi {
    registerTool(tool: ToolDefinition): void;
    registerService(service: ServiceDefinition): void;
    registerHttpRoute?(route: HttpRouteDefinition): void;
    runtime: {
      subagent: {
        run(params: {
          sessionKey: string;
          message: string;
          deliver?: boolean;
        }): Promise<{ result: unknown }>;
      };
      channel?: {
        dispatchInbound?(envelope: InboundEnvelope): Promise<void>;
      };
    };
  }

  /**
   * HTTP 路由定义
   */
  export interface HttpRouteDefinition {
    path: string;
    auth: 'plugin' | 'none';
    handler: (req: unknown, res: unknown) => Promise<boolean>;
  }

  /**
   * Inbound Envelope
   */
  export interface InboundEnvelope {
    channelId: string;
    conversationId: string;
    rawId: string;
    sender: {
      id: string;
      role: 'user' | 'system' | 'assistant';
    };
    content: {
      type: 'text' | 'media';
      text?: string;
    };
    metadata?: Record<string, unknown>;
  }

  /**
   * Tool 定义
   */
  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: Record<string, unknown>) => Promise<{
      content: Array<{ type: "text"; text: string }>;
    }>;
  }

  /**
   * Service 定义
   */
  export interface ServiceDefinition {
    id: string;
    start?: () => Promise<void>;
    stop?: () => void;
  }
}

declare module "openclaw/plugin-sdk/runtime-store" {
  import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";

  /**
   * Plugin Runtime Store
   * 用于在 register 回调外访问 runtime
   */
  export interface PluginRuntimeStore {
    getRuntime(): PluginRuntime;
    setRuntime(runtime: PluginRuntime): void;
    hasRuntime(): boolean;
  }

  /**
   * 创建 Plugin Runtime Store
   */
  export function createPluginRuntimeStore(): PluginRuntimeStore;
}

declare module "openclaw/plugin-sdk/inbound-envelope" {
  import type { InboundEnvelope } from "openclaw/plugin-sdk/channel-core";

  /**
   * 创建 Inbound Envelope
   */
  export function createInboundEnvelope(config: {
    channelId: string;
    conversationId: string;
    rawId: string;
    sender: {
      id: string;
      role: 'user' | 'system' | 'assistant';
    };
    content: {
      type: 'text' | 'media';
      text?: string;
    };
    metadata?: Record<string, unknown>;
  }): InboundEnvelope;
}
