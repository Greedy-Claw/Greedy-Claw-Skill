/**
 * Type stubs for openclaw/plugin-sdk/runtime-store
 *
 * These types are provided by the OpenClaw Gateway at runtime.
 * This file exists only to satisfy the TypeScript compiler.
 */

declare module "openclaw/plugin-sdk/runtime-store" {

  /** Resolved agent route from resolveAgentRoute */
  export interface ResolvedAgentRoute {
    agentId: string;
    channel: string;
    accountId: string;
    sessionKey: string;
    mainSessionKey: string;
    lastRoutePolicy: "main" | "session";
    matchedBy:
      | "binding.peer"
      | "binding.peer.parent"
      | "binding.peer.wildcard"
      | "binding.guild+roles"
      | "binding.guild"
      | "binding.team"
      | "binding.account"
      | "binding.channel"
      | "default";
  }

  /** Route peer specification */
  export interface RoutePeer {
    kind: "direct" | "group" | "channel";
    id: string;
  }

  /** Reply dispatcher created by createReplyDispatcherWithTyping */
  export interface ReplyDispatcher {
    sendToolResult: (result: any) => boolean;
    sendBlockReply: (reply: any) => boolean;
    sendFinalReply: (reply: any) => boolean;
    waitForIdle: () => Promise<void>;
    getQueuedCounts: () => { tool: number; block: number; final: number };
    getFailedCounts: () => { tool: number; block: number; final: number };
    markComplete: () => void;
  }

  /** Inbound context (MsgContext-like) after finalization */
  export interface FinalizedInboundContext {
    From: string;
    To: string;
    Body?: string;
    SessionKey?: string;
    CommandBody?: string;
    CommandAuthorized?: boolean;
    MediaPath?: string;
    MediaUrl?: string;
    [key: string]: any;
  }

  export interface PluginRuntime {
    channel: {
      turn: {
        run(options: ChannelTurnRunOptions): Promise<ChannelTurnResult>;
        runPrepared(options: any): Promise<any>;
        buildContext(options: any): any;
      };
      routing: {
        resolveAgentRoute(params: {
          cfg: any;
          channel: string;
          accountId?: string | null;
          peer?: RoutePeer | null;
          parentPeer?: RoutePeer | null;
          guildId?: string | null;
          teamId?: string | null;
          memberRoleIds?: string[];
        }): ResolvedAgentRoute;
        buildAgentSessionKey(params: {
          agentId: string;
          channel: string;
          accountId?: string | null;
          peer?: RoutePeer | null;
          dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
          identityLinks?: Record<string, string[]>;
        }): string;
      };
      session: {
        resolveStorePath(storeConfig: any, options: { agentId: string }): string | undefined;
        recordInboundSession(params: {
          storePath: string | undefined;
          sessionKey: string;
          ctx: any;
          updateLastRoute?: {
            sessionKey: string;
            channel: string;
            to: string;
            accountId: string | null;
          };
          onRecordError?: (err: any) => void;
        }): Promise<void>;
      };
      reply: {
        withReplyDispatcher(options: { dispatcher: any; run: () => any }): any;
        dispatchReplyFromConfig(options: {
          ctx: any;
          cfg: any;
          dispatcher: any;
          replyOptions?: any;
        }): Promise<any>;
        finalizeInboundContext(ctx: any): FinalizedInboundContext;
        createReplyDispatcherWithTyping(options: {
          humanDelay: any;
          typingCallbacks: any;
          deliver: (payload: any) => Promise<void>;
          onError?: (err: any, info: any) => void;
        }): {
          dispatcher: ReplyDispatcher;
          replyOptions: any;
          markDispatchIdle: () => void;
        };
        resolveHumanDelayConfig(cfg: any, agentId?: string | null): any;
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
    logging?: {
      shouldLogVerbose: () => boolean;
      getChildLogger: (
        bindings?: Record<string, unknown>,
        opts?: { level?: LogLevel },
      ) => RuntimeLogger;
    };
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

  export type LogLevel = "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";

  export interface RuntimeLogger {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
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
