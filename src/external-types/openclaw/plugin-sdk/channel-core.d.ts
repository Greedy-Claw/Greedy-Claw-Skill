/**
 * Type stubs for openclaw/plugin-sdk/channel-core
 *
 * These types are provided by the OpenClaw Gateway at runtime.
 * This file exists only to satisfy the TypeScript compiler.
 */

declare module "openclaw/plugin-sdk/channel-core" {

  export interface OpenClawConfig {
    channels?: Record<string, any>;
    plugins?: {
      entries?: Record<string, { config?: Record<string, any> }>;
    };
    [key: string]: any;
  }

  export interface ChannelPluginBase {
    id: string;
    config?: {
      listAccountIds?(cfg: OpenClawConfig): string[];
      resolveAccount?(cfg: OpenClawConfig, accountId?: string | null): any;
    };
    setup: {
      resolveAccount(cfg: OpenClawConfig, accountId?: string | null): any;
      inspectAccount(cfg: OpenClawConfig, accountId?: string | null): {
        enabled: boolean;
        configured: boolean;
        connected?: boolean;
        running?: boolean;
        lastInboundAt?: number | null;
        [key: string]: any;
      };
    };
    gateway?: {
      startAccount(account: any, ctx: any): Promise<{ started: boolean }>;
      stopAccount(account: any, ctx: any): Promise<{ stopped: boolean }>;
    };
  }

  export function createChannelPluginBase(options: {
    id: string;
    config?: ChannelPluginBase["config"];
    setup: ChannelPluginBase["setup"];
    gateway?: ChannelPluginBase["gateway"];
  }): ChannelPluginBase;

  export interface ChatChannelPlugin<TAccount> {
    base: ChannelPluginBase;
    security?: any;
    pairing?: any;
    threading?: any;
    outbound?: any;
  }

  export function createChatChannelPlugin<TAccount>(
    options: ChatChannelPluginOptions<TAccount>
  ): ChatChannelPlugin<TAccount>;

  export interface ChatChannelPluginOptions<TAccount> {
    base: ChannelPluginBase;
    security?: any;
    pairing?: any;
    threading?: any;
    outbound?: any;
  }

  export interface ChannelPluginEntryOptions {
    id: string;
    name: string;
    description: string;
    plugin: ChatChannelPlugin<any>;
    setRuntime?: (runtime: any) => void;
    registerCliMetadata?: (api: any) => void;
    registerFull?: (api: any) => void;
  }

  export function defineChannelPluginEntry(options: ChannelPluginEntryOptions): any;

  export function defineSetupPluginEntry(plugin: ChatChannelPlugin<any>): any;
}
