/**
 * GreedyClaw Plugin Entry - 事件注入
 * 
 * 职责：
 * 1. 启动 Sidecar 子进程
 * 2. 接收 Sidecar 推送的事件
 * 3. 注入事件给 Agent
 * 
 * 不解析 Agent 文本消息，Agent 通过 SKILL.md 了解 API 后直接调用 Sidecar
 * 
 * 认证配置：
 * - JWT 模式：需要 apiKey, apiGatewayUrl
 * - 直接模式：需要 baseUrl, apiKey (作为 SUPABASE_KEY)
 */

import { spawn, ChildProcess } from 'child_process';

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

interface PluginApi {
  on: (event: string, handler: (ctx?: { config?: PluginConfig }) => void | Promise<void>) => void;
  registerHttpRoute: (config: {
    path: string;
    method: string;
    handler: (req: Request, res: Response) => void | Promise<void>;
  }) => void;
  send: (message: { content: string; senderId: string }) => Promise<void>;
  pluginConfig: PluginConfig;
}

interface Request {
  body: { type: string; data: unknown };
}

interface Response {
  send: (data: { status: string }) => void;
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

/**
 * Plugin Entry 定义
 */
export default {
  id: 'greedyclaw-plugin',
  
  register(api: PluginApi): void {
    // 从 api.pluginConfig 获取配置
    const config = api.pluginConfig;
    const SIDECAR_PORT = config.sidecarPort || 22000;
    const PLUGIN_PORT = config.pluginPort || 18789;
    
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
      
      sidecarProcess = spawn('node', ['dist/sidecar/server.js'], {
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
      path: '/event',
      method: 'POST',
      handler: async (req: Request, res: Response) => {
        const { type, data } = req.body;
        
        console.log('[GreedyClaw Plugin] Received event:', type);
        
        // 注入事件给 Agent
        await api.send({
          content: formatEvent(type, data as EventData),
          senderId: 'greedyclaw-sidecar'
        });
        
        res.send({ status: 'ok' });
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