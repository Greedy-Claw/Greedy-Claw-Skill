/**
 * GreedyClaw Plugin Entry - 事件注入
 * 
 * 职责：
 * 1. 启动 Sidecar 子进程
 * 2. 接收 Sidecar 推送的事件
 * 3. 通过 api.runtime.agent.runEmbeddedAgent 直接触发 Agent turn
 * 
 * 不解析 Agent 文本消息，Agent 通过 SKILL.md 了解 API 后直接调用 Sidecar
 * 
 * 认证配置：
 * - JWT 模式：需要 apiKey, apiGatewayUrl
 * - 直接模式：需要 baseUrl, apiKey (作为 SUPABASE_KEY)
 */

import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PluginConfig {
  /** Supabase URL (直接模式) */
  baseUrl?: string;
  /** API Key：JWT 模式下为 sk_live_xxx，直接模式下为 Supabase service_role key */
  apiKey: string;
  /** API Gateway URL (JWT 模式必需) */
  apiGatewayUrl?: string;
  /** 本地 Supabase URL 覆盖 */
  localSupabaseUrl?: string;
  /** 认证模式：'jwt' | 'direct' */
  authMode?: 'jwt' | 'direct';
  /** Sidecar 端口 */
  sidecarPort?: number;
  /** Plugin 端口 */
  pluginPort?: number;
}

interface OpenClawConfig {
  [key: string]: any;
}

interface PluginApi {
  on: (event: string, handler: (ctx?: { config?: PluginConfig }) => void | Promise<void>) => void;
  registerHttpRoute: (config: {
    path: string;
    method: string;
    auth: 'gateway' | 'plugin';
    handler: (req: any, res: any) => void | Promise<void>;
  }) => void;
  pluginConfig: PluginConfig;
  config: OpenClawConfig;
  runtime: {
    agent: {
      resolveAgentDir: (cfg: OpenClawConfig) => string;
      resolveAgentWorkspaceDir: (cfg: OpenClawConfig) => string;
      resolveAgentTimeoutMs: (cfg: OpenClawConfig) => number;
      runEmbeddedAgent: (params: {
        sessionId: string;
        runId: string;
        sessionFile: string;
        workspaceDir: string;
        prompt: string;
        timeoutMs: number;
      }) => Promise<any>;
    };
    system: {
      enqueueSystemEvent: (event: any) => Promise<void>;
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

// Sidecar 进程引用
let sidecarProcess: ChildProcess | null = null;
// runtime 引用（在 register 中设置）
let pluginRuntime: PluginApi['runtime'] | null = null;
let pluginConfig: OpenClawConfig | null = null;

/**
 * 通过 api.runtime.agent.runEmbeddedAgent 直接触发 Agent turn
 * fallback: 通过 api.runtime.system.enqueueSystemEvent 注入系统事件
 */
async function injectEventToAgent(type: string, data: EventData): Promise<boolean> {
  const text = formatEvent(type, data);
  
  // 优先使用 runEmbeddedAgent 直接触发 Agent turn
  if (pluginRuntime?.agent?.runEmbeddedAgent && pluginConfig) {
    try {
      const sessionId = `greedyclaw:${type}:${data.id}`;
      const agentDir = pluginRuntime.agent.resolveAgentDir(pluginConfig);
      
      console.log(`[GreedyClaw Plugin] Triggering Agent turn via runEmbeddedAgent, sessionId=${sessionId}`);
      
      const result = await pluginRuntime.agent.runEmbeddedAgent({
        sessionId,
        runId: randomUUID(),
        sessionFile: join(agentDir, 'sessions', `${sessionId}.jsonl`),
        workspaceDir: pluginRuntime.agent.resolveAgentWorkspaceDir(pluginConfig),
        prompt: text,
        timeoutMs: pluginRuntime.agent.resolveAgentTimeoutMs(pluginConfig),
      });
      
      console.log(`[GreedyClaw Plugin] Agent turn completed:`, JSON.stringify(result));
      return true;
    } catch (err) {
      console.error('[GreedyClaw Plugin] runEmbeddedAgent failed, falling back to enqueueSystemEvent:', err);
      // fallback to enqueueSystemEvent below
    }
  }
  
  // Fallback: 使用 enqueueSystemEvent 注入系统事件
  if (pluginRuntime?.system?.enqueueSystemEvent) {
    try {
      console.log(`[GreedyClaw Plugin] Injecting event via enqueueSystemEvent: ${type}`);
      await pluginRuntime.system.enqueueSystemEvent({ type, text, data });
      return true;
    } catch (err) {
      console.error('[GreedyClaw Plugin] enqueueSystemEvent also failed:', err);
      return false;
    }
  }
  
  console.error('[GreedyClaw Plugin] No runtime API available to inject event');
  return false;
}

/**
 * Plugin Entry 定义
 */
export default {
  id: 'greedyclaw',
  
  register(api: PluginApi): void {
    // 从 api.pluginConfig 获取配置
    const config = api.pluginConfig;
    const SIDECAR_PORT = config.sidecarPort || 22000;
    const PLUGIN_PORT = config.pluginPort || 18789;
    
    // 存储 runtime 引用，供 injectEventToAgent 使用
    pluginRuntime = api.runtime;
    pluginConfig = api.config;
    
    // ========================================
    // 1. 启动 Sidecar 子进程
    // ========================================
    api.on('gateway_start', async (ctx) => {
      console.log('[GreedyClaw Plugin] Starting Sidecar...');
      
      // 优先使用 hook ctx 中的配置，fallback 到 api.pluginConfig
      const hookConfig = ctx?.config || config;
      
      // 确定认证模式
      const authMode = hookConfig.authMode || (hookConfig.apiGatewayUrl ? 'jwt' : 'direct');
      
      // 构建环境变量
      const env: Record<string, string> = {
        ...process.env,
        GREEDYCLAW_PORT: (hookConfig.sidecarPort || SIDECAR_PORT).toString(),
        OC_PORT: (hookConfig.pluginPort || PLUGIN_PORT).toString(),
        AUTH_MODE: authMode,
      };
      
      if (authMode === 'jwt') {
        // JWT 模式：传递 API Key 和 Gateway URL
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
        // 直接模式：传递 Supabase URL 和 Key
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
    });
    
    // ========================================
    // 2. 接收 Sidecar 推送的事件，注入给 Agent
    // ========================================
    api.registerHttpRoute({
      path: '/greedyclaw/event',
      method: 'POST',
      auth: 'plugin',
      handler: async (req: any, res: any) => {
        // OpenClaw 传入原生 IncomingMessage，需要手动读取 body
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
        
        // 通过 runEmbeddedAgent 直接触发 Agent turn
        const success = await injectEventToAgent(type, data as EventData);
        
        res.statusCode = success ? 200 : 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: success ? 'ok' : 'error' }));
      }
    });
  }
};

// ========================================
// 事件格式化（简洁提示）
// ========================================
function formatEvent(type: string, data: EventData): string {
  return `这是 GreedyClaw 事件，请调用 SKILL.md 检查并响应。

事件类型: ${type}
数据: ${JSON.stringify(data, null, 2)}`;
}
