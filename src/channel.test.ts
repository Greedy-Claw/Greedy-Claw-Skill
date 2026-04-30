import { describe, it, expect, vi, beforeEach } from 'vitest';
import { greedyclawPlugin, ResolvedAccount } from './channel.js';

describe('greedyclaw plugin', () => {
  describe('setup', () => {
    it('resolves account from config', () => {
      const cfg = {
        plugins: {
          entries: {
            'greedyclaw': {
              config: {
                apiKey: 'test-api-key',
                apiGatewayUrl: 'https://api.example.com',
                supabaseUrl: 'https://supabase.example.com',
                anonKey: 'test-anon-key',
              },
            },
          },
        },
      } as any;

      const account = greedyclawPlugin.setup!.resolveAccount(cfg, undefined) as ResolvedAccount;
      expect(account.apiKey).toBe('test-api-key');
      expect(account.apiGatewayUrl).toBe('https://api.example.com');
      expect(account.supabaseUrl).toBe('https://supabase.example.com');
    });

    it('inspects account without materializing secrets', () => {
      const cfg = {
        plugins: {
          entries: {
            'greedyclaw': {
              config: {
                apiKey: 'test-api-key',
                apiGatewayUrl: 'https://api.example.com',
              },
            },
          },
        },
      } as any;

      const result = greedyclawPlugin.setup!.inspectAccount!(cfg, undefined);
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(true);
    });

    it('reports missing config', () => {
      const cfg = { channels: {} } as any;
      const result = greedyclawPlugin.setup!.inspectAccount!(cfg, undefined);
      expect(result.configured).toBe(false);
      expect(result.enabled).toBe(false);
    });
  });

  describe('security', () => {
    it('has DM security configuration', () => {
      expect((greedyclawPlugin as any).security?.dm).toBeDefined();
      expect((greedyclawPlugin as any).security?.dm?.channelKey).toBe('greedyclaw');
    });
  });

  describe('messaging', () => {
    it('has resolveSessionConversation', () => {
      expect((greedyclawPlugin as any).messaging?.resolveSessionConversation).toBeDefined();
    });

    it('resolves session conversation for bid ID', () => {
      const resolve = (greedyclawPlugin as any).messaging?.resolveSessionConversation;
      if (!resolve) {
        throw new Error('resolveSessionConversation not defined');
      }

      const result = resolve('bid-123');
      expect(result.conversationId).toBe('bid-123');
      expect(result.threadId).toBeNull();
    });
  });
});

describe('webhook handler', () => {
  // Mock PluginApi
  const createMockApi = () => ({
    runtime: {
      channel: {
        dispatchInbound: vi.fn().mockResolvedValue(undefined),
      },
      subagent: {
        run: vi.fn().mockResolvedValue(undefined),
      },
    },
    registerHttpRoute: vi.fn(),
    registerService: vi.fn(),
    registerTool: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createWebhookHandler is defined', async () => {
    const { createWebhookHandler } = await import('./inbound.js');
    expect(createWebhookHandler).toBeDefined();
    expect(typeof createWebhookHandler).toBe('function');
  });

  it('handles new_task event', async () => {
    const { createWebhookHandler } = await import('./inbound.js');
    const mockApi = createMockApi() as any;
    const handler = createWebhookHandler(mockApi);

    const req = {
      body: JSON.stringify({
        type: 'new_task',
        payload: {
          taskId: 'test-task-123',
          data: {
            id: 'test-task-123',
            instruction: 'Test task',
            status: 'OPEN',
          },
        },
      }),
    };

    const res = {
      statusCode: 200,
      end: vi.fn(),
    };

    await handler(req, res);

    expect(mockApi.runtime.channel.dispatchInbound).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('handles task_assigned event', async () => {
    const { createWebhookHandler } = await import('./inbound.js');
    const mockApi = createMockApi() as any;
    const handler = createWebhookHandler(mockApi);

    const req = {
      body: JSON.stringify({
        type: 'task_assigned',
        payload: {
          taskId: 'test-task-456',
          data: {
            id: 'test-task-456',
            instruction: 'Assigned task',
            status: 'NEGOTIATING',
            executor_id: 'executor-123',
          },
        },
      }),
    };

    const res = {
      statusCode: 200,
      end: vi.fn(),
    };

    await handler(req, res);

    // task_assigned 使用 dispatchInbound 而不是 subagent.run
    expect(mockApi.runtime.channel.dispatchInbound).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('handles new_message event', async () => {
    const { createWebhookHandler } = await import('./inbound.js');
    const mockApi = createMockApi() as any;
    const handler = createWebhookHandler(mockApi);

    const req = {
      body: JSON.stringify({
        type: 'new_message',
        payload: {
          bidId: 'bid-123',
          senderId: 'sender-456',
          data: {
            id: 'msg-789',
            content: 'Hello!',
            bid_id: 'bid-123',
            sender_id: 'sender-456',
          },
        },
      }),
    };

    const res = {
      statusCode: 200,
      end: vi.fn(),
    };

    await handler(req, res);

    // new_message 使用 dispatchInbound
    expect(mockApi.runtime.channel.dispatchInbound).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});

describe('observer service', () => {
  it('buildNewTaskMessage creates correct message', async () => {
    const { buildNewTaskMessage } = await import('./observer.js');
    
    const task = {
      id: 'task-123',
      instruction: 'Test task instruction',
      status: 'OPEN',
      currency_type: 'COINS',
      locked_amount: 100,
    };

    const message = buildNewTaskMessage(task);
    expect(message).toContain('新任务');
    expect(message).toContain('task-123');
    expect(message).toContain('Test task instruction');
  });

  it('buildAssignedTaskMessage creates correct message', async () => {
    const { buildAssignedTaskMessage } = await import('./observer.js');
    
    const task = {
      id: 'task-456',
      instruction: 'Assigned task',
      status: 'NEGOTIATING',
    };

    const message = buildAssignedTaskMessage(task);
    expect(message).toContain('中标');
    expect(message).toContain('task-456');
  });

  it('buildClientMessageMessage creates correct message', async () => {
    const { buildClientMessageMessage } = await import('./observer.js');
    
    const msg = {
      id: 'msg-123',
      content: 'Hello from client',
      bid_id: 'bid-456',
      sender_id: 'sender-123',
    };

    const message = buildClientMessageMessage(msg);
    expect(message).toContain('客户消息');
    expect(message).toContain('Hello from client');
    expect(message).toContain('bid-456');
  });
});
