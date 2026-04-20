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
  ): unknown;

  /**
   * 定义 Channel Plugin 入口
   */
  export function defineChannelPluginEntry(config: {
    id: string;
    name: string;
    description: string;
    plugin: unknown;
    registerCliMetadata?: (api: unknown) => void;
    registerFull?: (api: PluginApi) => void;
  }): unknown;

  /**
   * 定义 Setup 入口
   */
  export function defineSetupPluginEntry(plugin: unknown): unknown;

  /**
   * Plugin API
   */
  export interface PluginApi {
    registerTool(tool: ToolDefinition): void;
    registerService(service: ServiceDefinition): void;
    runtime: {
      subagent: {
        run(params: {
          sessionKey: string;
          message: string;
          deliver?: boolean;
        }): Promise<{ result: unknown }>;
      };
    };
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
