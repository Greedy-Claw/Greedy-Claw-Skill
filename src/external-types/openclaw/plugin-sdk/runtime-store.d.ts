/**
 * Type stubs for openclaw/plugin-sdk/runtime-store
 *
 * These types are provided by the OpenClaw Gateway at runtime.
 * This file exists only to satisfy the TypeScript compiler.
 */

declare module "openclaw/plugin-sdk/runtime-store" {

  export interface PluginRuntime {
    channel: {
      turn: {
        run(options: ChannelTurnRunOptions): Promise<ChannelTurnResult>;
        runPrepared(options: any): Promise<any>;
        buildContext(options: any): any;
      };
      session?: {
        resolveStorePath(storeConfig: any, options: { agentId: string }): string | undefined;
        recordInboundSession(params: any): Promise<void>;
      };
      reply?: {
        withReplyDispatcher(options: { dispatcher: any; run: () => any }): any;
        dispatchReplyFromConfig(options: { ctx: any; cfg: any; dispatcher: any }): any;
      };
      mentions?: any;
    };
    subagent: {
      run(params: { sessionKey: string; message: string; deliver?: boolean }): Promise<{ runId: string }>;
      waitForRun(params: { runId: string; timeoutMs?: number }): Promise<any>;
      getSessionMessages(params: { sessionKey: string; limit?: number }): Promise<{ messages: any[] }>;
      deleteSession(params: { sessionKey: string }): Promise<void>;
    };
    agent?: any;
    config?: any;
    log?: any;
    [key: string]: any;
  }

  export interface ChannelTurnRunOptions {
    channel: string;
    accountId: string | null;
    raw: any;
    adapter: ChannelTurnAdapter;
    log?: (event: any) => void;
  }

  export interface ChannelTurnAdapter {
    ingest(raw: any): NormalizedTurnInput | Promise<NormalizedTurnInput | null> | null;
    classify?(input: NormalizedTurnInput): ChannelEventClass | Promise<ChannelEventClass>;
    preflight?(input: NormalizedTurnInput, eventClass: ChannelEventClass): any;
    resolveTurn(input: NormalizedTurnInput, eventClass?: any, preflight?: any): ChannelTurnResolved | Promise<ChannelTurnResolved>;
    onFinalize?(result: ChannelTurnResult): void | Promise<void>;
  }

  export interface NormalizedTurnInput {
    id: string;
    timestamp?: number;
    rawText: string;
    textForAgent?: string;
    textForCommands?: string;
    raw?: any;
  }

  export interface ChannelEventClass {
    kind: string;
    canStartAgentTurn: boolean;
  }

  export interface ChannelTurnResolved {
    channel?: string;
    accountId?: string | null;
    routeSessionKey?: string;
    storePath?: string | undefined;
    ctxPayload?: any;
    recordInboundSession?: (params: any) => Promise<void>;
    record?: { createIfMissing?: boolean; [key: string]: any };
    sender?: any;
    conversation?: any;
    route?: any;
    reply?: any;
    message?: any;
    access?: any;
    delivery?: {
      deliver(payload: any, info: any): Promise<ChannelDeliveryResult | void>;
    };
    admission?: any;
    ctx?: any;
    cfg?: any;
    dispatcherOptions?: any;
    runDispatch?: () => Promise<any>;
  }

  export interface ChannelTurnResult {
    admission?: any;
    sessionKey?: string;
    [key: string]: any;
  }

  export interface ChannelDeliveryResult {
    messageIds?: string[];
    threadId?: string;
    replyToId?: string;
    visibleReplySent?: boolean;
  }

  export interface PluginRuntimeStoreOptions {
    pluginId: string;
    errorMessage: string;
  }

  export function createPluginRuntimeStore<T = PluginRuntime>(
    options: PluginRuntimeStoreOptions
  ): {
    setRuntime: (runtime: T) => void;
    getRuntime: () => T;
    tryGetRuntime: () => T | null;
  };
}
