/**
 * Mock for openclaw/plugin-sdk modules
 * 用于本地测试环境
 */

import { vi } from 'vitest';

// Mock createChatChannelPlugin
export const createChatChannelPlugin = vi.fn(<_T>(config: any) => {
  return {
    id: config.base?.id || 'mock-channel',
    setup: config.base?.setup,
    security: config.security,
    threading: config.threading,
    messaging: config.messaging,
    outbound: config.outbound,
  };
});

// Mock createChannelPluginBase
export const createChannelPluginBase = vi.fn((config: any) => {
  return {
    id: config.id,
    setup: config.setup,
  };
});

// Mock OpenClawConfig type
export type OpenClawConfig = Record<string, any>;

// Mock InboundEnvelope
export interface InboundEnvelope {
  channelId: string;
  conversationId: string;
  rawId: string;
  sender: {
    id: string;
    role: string;
  };
  content: {
    type: string;
    text: string;
  };
  metadata?: Record<string, any>;
}

// Mock createInboundEnvelope
export const createInboundEnvelope = vi.fn((config: any) => config);

// Mock PluginApi
export interface PluginApi {
  runtime?: {
    channel?: {
      dispatchInbound: (envelope: InboundEnvelope) => Promise<void>;
    };
    subagent?: {
      run: (params: { sessionKey: string; message: string; deliver?: boolean }) => Promise<void>;
    };
  };
  registerHttpRoute?: (def: any) => void;
  registerService?: (def: any) => void;
  registerTool?: (def: any) => void;
}

// Mock HttpRouteDefinition
export interface HttpRouteDefinition {
  path: string;
  auth: string;
  handler: (req: any, res: any) => Promise<boolean>;
}

// Mock ToolDefinition
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any) => Promise<any>;
}

// Mock ServiceDefinition
export interface ServiceDefinition {
  name: string;
  start: () => Promise<void>;
  stop?: () => Promise<void>;
}

// Mock defineChannelPluginEntry
export const defineChannelPluginEntry = vi.fn((config: any) => config);

// Mock createInboundEnvelope
export function createInboundEnvelopeMock(config: Partial<InboundEnvelope>): InboundEnvelope {
  return {
    channelId: config.channelId || 'mock',
    conversationId: config.conversationId || 'mock',
    rawId: config.rawId || 'mock',
    sender: config.sender || { id: 'mock', role: 'user' },
    content: config.content || { type: 'text', text: '' },
    metadata: config.metadata,
  };
}
