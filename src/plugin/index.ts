/**
 * GreedyClaw Plugin Entry - 事件注入 + 工具注册
 * 
 * 职责：
 * 1. 启动 Sidecar 子进程
 * 2. 注册 GreedyClaw 工具（agent 直接调用，不需要 curl）
 * 3. 接收 Sidecar 推送的事件（HTTP route → 队列）
 * 4. 通过 api.runtime.subagent.run 为每个 task 开启独立对话
 */

import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PluginConfig {
  baseUrl?: string;
  apiKey: string;
  apiGatewayUrl?: string;
  localSupabaseUrl?: string;
  authMode?: 'jwt' | 'direct';
  sidecarPort?: number;
  pluginPort?: number;
}

interface PluginApi {
  on: (event: string, handler: (ctx?: { config?: PluginConfig }) => void | Promise<void>) => void;
  registerHttpRoute: (config: {
    path: string;
    method: string;
    auth: 'gateway' | 'plugin';
    handler: (req: any, res: any) => void | Promise<void>;
  }) => void;
  registerTool: (tool: any, opts?: { name?: string }) => void;
  pluginConfig: PluginConfig;
  runtime: {
    subagent: {
      run: (params: {
        sessionKey: string;
        message: string;
        deliver?: boolean;
      }) => Promise<{ runId: string }>;
      waitForRun: (params: { runId: string; timeoutMs?: number }) => Promise<any>;
    };
  };
}

interface EventData {
  id: string;
  task_id?: string;
  bid_id?: string;
  status?: string;
  sender_id?: string;
  content?: string;
  created_at?: string;
  instruction?: string;
  reward?: number;
  deadline?: string;
}

// ========================================
// 全局状态
// ========================================
let sidecarProcess: ChildProcess | null = null;
let pluginRuntime: PluginApi['runtime'] | null = null;
let sidecarPort: number = 22000;
const eventQueue: { type: string; data: EventData }[] = [];
let queuePoller: ReturnType<typeof setInterval> | null = null;

// ========================================
// Sidecar HTTP 调用
// ========================================
async function sidecarFetch(path: string, options?: { method?: string; body?: any }): Promise<any> {
  const url = `http://localhost:${sidecarPort}${path}`;
  const resp = await fetch(url, {
    method: options?.method || 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sidecar ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ========================================
// 工具定义
// ========================================
function createTools() {
  return [
    {
      name: 'greedyclaw_get_task_info',
      label: 'GreedyClaw Get Task Info',
      description: '获取 GreedyClaw 任务信息。收到 new_task 事件后调用此工具评估任务。',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: '任务 ID',
          },
        },
        required: ['taskId'],
      },
      execute: async (_toolCallId: string, args: { taskId: string }) => {
        try {
          const tasks = await sidecarFetch('/tasks');
          const task = Array.isArray(tasks)
            ? tasks.find((t: any) => t.id === args.taskId)
            : null;
          if (!task) {
            return {
              content: [{ type: 'text' as const, text: `未找到任务 ${args.taskId}` }],
            };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `获取任务信息失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_post_bid',
      label: 'GreedyClaw Post Bid',
      description: '提交任务竞标。评估任务后决定竞标时调用。需提供价格、预计完成时间和提案。',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: '任务 ID',
          },
          price: {
            type: 'number',
            description: '竞标价格（银币或金币，与任务的 currency_type 一致）',
          },
          etaSeconds: {
            type: 'number',
            description: '预计完成时间（秒）',
          },
          proposal: {
            type: 'string',
            description: '竞标提案（Markdown 格式，说明你的优势和执行计划）',
          },
        },
        required: ['taskId', 'price', 'etaSeconds'],
      },
      execute: async (_toolCallId: string, args: { taskId: string; price: number; etaSeconds: number; proposal?: string }) => {
        try {
          const result = await sidecarFetch('/bid', {
            method: 'POST',
            body: {
              taskId: args.taskId,
              price: args.price,
              etaSeconds: args.etaSeconds,
              proposal: args.proposal,
            },
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `竞标失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_send_message',
      label: 'GreedyClaw Send Message',
      description: '发送消息给雇主，用于洽谈任务细节。竞标后可主动联系雇主。',
      parameters: {
        type: 'object',
        properties: {
          bidId: {
            type: 'string',
            description: '竞标 ID',
          },
          content: {
            type: 'string',
            description: '消息内容',
          },
        },
        required: ['bidId', 'content'],
      },
      execute: async (_toolCallId: string, args: { bidId: string; content: string }) => {
        try {
          const result = await sidecarFetch('/message', {
            method: 'POST',
            body: {
              bidId: args.bidId,
              content: args.content,
            },
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `发送消息失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_submit_delivery',
      label: 'GreedyClaw Submit Delivery',
      description: '提交任务交付结果。中标并完成任务后调用。',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: '任务 ID',
          },
          result: {
            type: 'string',
            description: '任务结果（JSON 字符串或纯文本）',
          },
          deliverySummary: {
            type: 'string',
            description: '交付摘要（纯文本，最多 500 字符）',
          },
          deliveryMd: {
            type: 'string',
            description: '交付详情（Markdown 格式）',
          },
        },
        required: ['taskId', 'result'],
      },
      execute: async (_toolCallId: string, args: { taskId: string; result: string; deliverySummary?: string; deliveryMd?: string }) => {
        try {
          let resultData: any;
          try {
            resultData = JSON.parse(args.result);
          } catch {
            resultData = args.result;
          }
          const body: any = {
            taskId: args.taskId,
            result: resultData,
          };
          if (args.deliverySummary) body.deliverySummary = args.deliverySummary;
          if (args.deliveryMd) body.deliveryMd = args.deliveryMd;

          const result = await sidecarFetch('/submit', {
            method: 'POST',
            body,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `提交交付失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_get_balance',
      label: 'GreedyClaw Get Balance',
      description: '查询 GreedyClaw 钱包余额。',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          // Sidecar 没有独立的 /balance 端点，通过 /auth/status 获取
          const status = await sidecarFetch('/auth/status');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `查询余额失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_upload_file',
      label: 'GreedyClaw Upload File',
      description: '上传文件到任务交付目录。中标后需要上传交付文件时调用。文件将被上传到 task-deliveries bucket 并创建 storage_files 记录。',
      parameters: {
        type: 'object',
        properties: {
          bidId: {
            type: 'string',
            description: '竞标 ID',
          },
          fileName: {
            type: 'string',
            description: '原始文件名（含扩展名），如 "report.pdf"',
          },
          fileBase64: {
            type: 'string',
            description: '文件的 Base64 编码内容',
          },
          description: {
            type: 'string',
            description: '文件描述（可选）',
          },
        },
        required: ['bidId', 'fileName', 'fileBase64'],
      },
      execute: async (_toolCallId: string, args: { bidId: string; fileName: string; fileBase64: string; description?: string }) => {
        try {
          const result = await sidecarFetch('/files/upload', {
            method: 'POST',
            body: {
              bidId: args.bidId,
              fileName: args.fileName,
              fileBase64: args.fileBase64,
              userMetadata: args.description ? { description: args.description } : undefined,
            },
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `上传文件失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_list_files',
      label: 'GreedyClaw List Files',
      description: '列出任务交付文件。可查看某个 bid 下的所有上传文件。RLS 自动过滤，只能看到有权限的文件。',
      parameters: {
        type: 'object',
        properties: {
          bidId: {
            type: 'string',
            description: '竞标 ID（可选，不传则列出所有有权限的文件）',
          },
        },
      },
      execute: async (_toolCallId: string, args: { bidId?: string }) => {
        try {
          const query = args.bidId ? `?bidId=${args.bidId}` : '';
          const result = await sidecarFetch(`/files/list${query}`);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `列出文件失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_download_file',
      label: 'GreedyClaw Download File',
      description: '下载任务交付文件。返回文件的 Base64 编码内容和原始文件名。需要知道文件的 ID（可通过 list_files 获取）。',
      parameters: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: '文件 ID（storage_files 表的 id）',
          },
        },
        required: ['fileId'],
      },
      execute: async (_toolCallId: string, args: { fileId: string }) => {
        try {
          const url = `http://localhost:${sidecarPort}/files/download/${args.fileId}`;
          const resp = await fetch(url);
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Download failed: ${resp.status} ${text}`);
          }

          const contentType = resp.headers.get('content-type') || 'application/octet-stream';
          const contentDisposition = resp.headers.get('content-disposition') || '';
          const buffer = Buffer.from(await resp.arrayBuffer());
          const base64 = buffer.toString('base64');

          // 从 Content-Disposition 解析文件名
          let fileName = 'download';
          const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
          if (match) {
            fileName = decodeURIComponent(match[1]);
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                fileName,
                contentType,
                sizeBytes: buffer.length,
                fileBase64: base64,
              }, null, 2),
            }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `下载文件失败: ${err.message}` }],
          };
        }
      },
    },
    {
      name: 'greedyclaw_delete_file',
      label: 'GreedyClaw Delete File',
      description: '删除任务交付文件。同时删除 Storage 对象和 storage_files 记录。',
      parameters: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: '文件 ID（storage_files 表的 id）',
          },
        },
        required: ['fileId'],
      },
      execute: async (_toolCallId: string, args: { fileId: string }) => {
        try {
          const result = await sidecarFetch(`/files/delete/${args.fileId}`, {
            method: 'DELETE',
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `删除文件失败: ${err.message}` }],
          };
        }
      },
    },
  ];
}

// ========================================
// 事件队列处理
// ========================================
async function processEventQueue(): Promise<void> {
  if (!pluginRuntime?.subagent?.run) return;
  if (eventQueue.length === 0) return;

  const batch = eventQueue.splice(0, eventQueue.length);

  for (const event of batch) {
    try {
      const text = formatEvent(event.type, event.data);
      const taskKey = event.data.task_id || event.data.id;
      // 使用 OpenClaw 标准 subagent sessionKey 格式: agent:<agentId>:subagent:<suffix>
      // 这样 OpenClaw 能识别该 session 为 subagent，并正确注入 plugin tools
      const sessionKey = `agent:main:subagent:greedyclaw:task:${taskKey}`;

      console.log(`[GreedyClaw Plugin] Processing event: ${event.type}, sessionKey=${sessionKey}`);

      const { runId } = await pluginRuntime.subagent.run({
        sessionKey,
        message: text,
        deliver: false,
      });

      console.log(`[GreedyClaw Plugin] Subagent started: runId=${runId}, sessionKey=${sessionKey}`);
    } catch (err) {
      console.error(`[GreedyClaw Plugin] Failed to process event ${event.type}:`, err);
    }
  }
}

// ========================================
// Plugin Entry
// ========================================
export default {
  id: 'greedyclaw',

  register(api: PluginApi): void {
    const config = api.pluginConfig;
    const SIDECAR_PORT = config.sidecarPort || 22000;
    const PLUGIN_PORT = config.pluginPort || 18789;
    sidecarPort = SIDECAR_PORT;
    pluginRuntime = api.runtime;

    // ========================================
    // 1. 注册工具
    // ========================================
    const tools = createTools();
    for (const tool of tools) {
      api.registerTool(tool, { name: tool.name });
    }
    console.log(`[GreedyClaw Plugin] Registered ${tools.length} tools`);

    // ========================================
    // 2. 启动 Sidecar + 事件队列轮询器
    // ========================================
    api.on('gateway_start', async (ctx) => {
      console.log('[GreedyClaw Plugin] Starting Sidecar...');

      const hookConfig = ctx?.config || config;
      const authMode = hookConfig.authMode || (hookConfig.apiGatewayUrl ? 'jwt' : 'direct');

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        GREEDYCLAW_PORT: (hookConfig.sidecarPort || SIDECAR_PORT).toString(),
        OC_PORT: (hookConfig.pluginPort || PLUGIN_PORT).toString(),
        AUTH_MODE: authMode,
      };

      if (authMode === 'jwt') {
        if (!hookConfig.apiKey || !hookConfig.apiGatewayUrl) {
          console.error('[GreedyClaw Plugin] JWT mode requires apiKey and apiGatewayUrl');
          process.exit(1);
        }
        env.API_KEY = hookConfig.apiKey;
        env.API_GATEWAY_URL = hookConfig.apiGatewayUrl;
        if (hookConfig.localSupabaseUrl) {
          env.LOCAL_SUPABASE_URL = hookConfig.localSupabaseUrl;
        }
        console.log(`[GreedyClaw Plugin] Using JWT auth, gateway: ${hookConfig.apiGatewayUrl}`);
      } else {
        if (!hookConfig.baseUrl || !hookConfig.apiKey) {
          console.error('[GreedyClaw Plugin] Direct mode requires baseUrl and apiKey');
          process.exit(1);
        }
        env.SUPABASE_URL = hookConfig.baseUrl;
        env.SUPABASE_KEY = hookConfig.apiKey;
        console.log(`[GreedyClaw Plugin] Using direct auth, supabase: ${hookConfig.baseUrl}`);
      }

      const sidecarPath = join(__dirname, '..', 'sidecar', 'server.cjs');
      sidecarProcess = spawn('node', [sidecarPath], {
        stdio: 'inherit',
        env
      });

      sidecarProcess.on('error', (err: Error) => {
        console.error('[GreedyClaw Plugin] Sidecar failed to start:', err);
      });

      sidecarProcess.on('exit', (code: number | null) => {
        console.log(`[GreedyClaw Plugin] Sidecar exited with code ${code}`);
        sidecarProcess = null;
      });

      // 启动队列轮询器
      if (!queuePoller) {
        queuePoller = setInterval(() => {
          processEventQueue().catch(err => {
            console.error('[GreedyClaw Plugin] Queue poller error:', err);
          });
        }, 2000);
        console.log('[GreedyClaw Plugin] Event queue poller started (2s interval)');
      }
    });

    // ========================================
    // 3. HTTP route：接收 Sidecar 推送，写入队列
    // ========================================
    api.registerHttpRoute({
      path: '/greedyclaw/event',
      method: 'POST',
      auth: 'plugin',
      handler: async (req: any, res: any) => {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => resolve(Buffer.concat(chunks).toString()));
          req.on('error', reject);
        });

        let parsed: { type: string; data: unknown };
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          console.error('[GreedyClaw Plugin] Failed to parse event body:', e);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
          return;
        }

        const { type, data } = parsed;
        console.log(`[GreedyClaw Plugin] Received event: ${type}`);

        eventQueue.push({ type, data: data as EventData });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', queued: true }));
      }
    });
  }
};

// ========================================
// 事件格式化
// ========================================
function formatEvent(type: string, data: EventData): string {
  return `[GreedyClaw 事件] 类型: ${type}\n数据: ${JSON.stringify(data, null, 2)}\n\n请根据 GreedyClaw插件的SKILL.md 检查并响应此事件。`;
}
