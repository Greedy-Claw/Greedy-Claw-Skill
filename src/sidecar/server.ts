/**
 * GreedyClaw Sidecar - 纯消息转换层
 * 
 * 职责：
 * 1. HTTP API → Supabase 调用
 * 2. Realtime 监听 → 推送给 Plugin
 * 
 * 不做业务判断，所有决策由 Agent 完成
 * 
 * 认证模式：
 * - JWT 模式（推荐）：通过 API Gateway 获取 JWT，带用户身份
 * - 直接模式（开发）：使用 SUPABASE_URL + SUPABASE_KEY
 */

import express, { Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthManager } from '../auth/AuthManager.js';

const app = express();
app.use(express.json());

// ========================================
// 配置 - 从环境变量获取（由 Plugin Entry 传递）
// ========================================
const PORT = parseInt(process.env.GREEDYCLAW_PORT || '22000', 10);
const PLUGIN_PORT = parseInt(process.env.OC_PORT || '18789', 10);
const PLUGIN_URL = `http://localhost:${PLUGIN_PORT}/greedyclaw/event`;

// 认证相关环境变量
const AUTH_MODE = process.env.AUTH_MODE || 'direct'; // 'jwt' | 'direct'
const API_KEY = process.env.API_KEY;
const API_GATEWAY_URL = process.env.API_GATEWAY_URL;
const LOCAL_SUPABASE_URL = process.env.LOCAL_SUPABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ========================================
// Supabase 客户端初始化
// ========================================
let supabase: SupabaseClient;
let authManager: AuthManager | null = null;
let executorId: string | null = null;

/**
 * 初始化 Supabase 客户端
 */
async function initializeSupabase(): Promise<void> {
  if (AUTH_MODE === 'jwt' && API_KEY && API_GATEWAY_URL) {
    // JWT 模式：通过 API Gateway 获取用户身份
    console.log('[Sidecar] 使用 JWT 认证模式');
    
    authManager = new AuthManager({
      apiKey: API_KEY,
      apiGatewayUrl: API_GATEWAY_URL,
      localSupabaseUrl: LOCAL_SUPABASE_URL,
    });
    
    await authManager.authenticate();
    supabase = authManager.client;
    executorId = authManager.executorId;
    
    console.log(`[Sidecar] 已认证用户: ${executorId}`);
  } else if (SUPABASE_URL && SUPABASE_KEY) {
    // 直接模式：使用 service_role key
    console.log('[Sidecar] 使用直接认证模式（开发环境）');
    
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
    
    console.log('[Sidecar] Supabase 连接成功（无用户身份）');
  } else {
    console.error('[Sidecar] Missing required config');
    console.error('[Sidecar] JWT mode requires: API_KEY, API_GATEWAY_URL');
    console.error('[Sidecar] Direct mode requires: SUPABASE_URL, SUPABASE_KEY');
    process.exit(1);
  }
}

// ========================================
// 中间件：确保已认证
// ========================================
async function ensureAuthenticated(_req: Request, res: Response, next: Function): Promise<void> {
  try {
    // JWT 模式下检查并刷新 session
    if (authManager) {
      await authManager.refreshIfNeeded();
      executorId = authManager.executorId;
    }
    next();
  } catch (error) {
    console.error('[Sidecar] Auth error:', error);
    res.status(401).json({ error: '认证失败，请检查配置' });
  }
}

// ========================================
// HTTP API：纯透传，不做业务判断
// ========================================

/**
 * GET /health
 * 健康检查
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    authMode: AUTH_MODE,
    executorId: executorId || 'anonymous'
  });
});

/**
 * GET /auth/status
 * 查看认证状态
 */
app.get('/auth/status', (_req: Request, res: Response) => {
  res.json({
    authMode: AUTH_MODE,
    isAuthenticated: !!supabase,
    executorId: executorId,
    sessionExpiring: authManager?.isSessionExpiring() ?? true,
  });
});

/**
 * GET /tasks
 * 获取所有开放任务列表
 */
app.get('/tasks', ensureAuthenticated, async (_req: Request, res: Response) => {
  const { data, error } = await supabase.rpc('get_open_tasks');
  
  if (error) {
    console.error('[Sidecar] get_open_tasks error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

/**
 * POST /bid
 * 提交竞标
 */
app.post('/bid', ensureAuthenticated, async (req: Request, res: Response) => {
  const { taskId, proposal } = req.body;
  
  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }
  
  const { data, error } = await supabase.rpc('place_bid', {
    p_task_id: taskId,
    p_proposal: proposal || null
  });
  
  if (error) {
    console.error('[Sidecar] place_bid error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

/**
 * POST /message
 * 发送消息给雇主
 */
app.post('/message', ensureAuthenticated, async (req: Request, res: Response) => {
  const { bidId, content } = req.body;
  
  if (!bidId || !content) {
    return res.status(400).json({ error: 'bidId and content are required' });
  }
  
  const { data, error } = await supabase.rpc('send_bid_message', {
    p_bid_id: bidId,
    p_content: content
  });
  
  if (error) {
    console.error('[Sidecar] send_bid_message error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

/**
 * POST /submit
 * 提交任务结果
 */
app.post('/submit', ensureAuthenticated, async (req: Request, res: Response) => {
  const { taskId, result } = req.body;
  
  if (!taskId || !result) {
    return res.status(400).json({ error: 'taskId and result are required' });
  }
  
  const { data, error } = await supabase.rpc('submit_task_result', {
    p_task_id: taskId,
    p_result: result
  });
  
  if (error) {
    console.error('[Sidecar] submit_task_result error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

// ========================================
// Realtime 监听：推送给 Plugin
// ========================================

interface EventData {
  id: string;
  task_id?: string;
  bid_id?: string;
  status?: string;
  sender_id?: string;
  content?: string;
  created_at?: string;
}

/**
 * 推送事件给 Plugin
 */
async function pushToPlugin(type: string, data: EventData): Promise<void> {
  try {
    const response = await fetch(PLUGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    });
    
    if (!response.ok) {
      console.error('[Sidecar] pushToPlugin failed:', response.status);
    }
  } catch (error) {
    console.error('[Sidecar] pushToPlugin error:', (error as Error).message);
  }
}

/**
 * 设置 Realtime 监听
 */
function setupRealtimeListeners(): void {
  // 监听新任务
  supabase
    .channel('tasks-channel')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'tasks' }, 
      (payload) => {
        console.log('[Sidecar] new_task:', payload.new.id);
        pushToPlugin('new_task', payload.new as EventData);
      }
    )
    .subscribe();

  // 监听 bid 状态变化
  supabase
    .channel('bids-channel')
    .on('postgres_changes', 
      { event: 'UPDATE', schema: 'public', table: 'bids' }, 
      (payload) => {
        const bid = payload.new as EventData;
        const eventType = bid.status === 'accepted' ? 'bid_accepted' : 'bid_rejected';
        console.log('[Sidecar] bid update:', bid.id, '→', bid.status);
        pushToPlugin(eventType, bid);
      }
    )
    .subscribe();

  // 监听新消息 (bids_messages)
  supabase
    .channel('bids-messages-channel')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'bids_messages' }, 
      (payload) => {
        console.log('[Sidecar] new_message:', payload.new.id);
        pushToPlugin('new_message', payload.new as EventData);
      }
    )
    .subscribe();
}

// ========================================
// 启动服务
// ========================================
async function start(): Promise<void> {
  try {
    await initializeSupabase();
    setupRealtimeListeners();
    
    app.listen(PORT, () => {
      console.log(`[Sidecar] Running on port ${PORT}`);
      console.log(`[Sidecar] Plugin URL: ${PLUGIN_URL}`);
      console.log(`[Sidecar] Health: http://localhost:${PORT}/health`);
      console.log(`[Sidecar] Auth mode: ${AUTH_MODE}`);
    });
  } catch (error) {
    console.error('[Sidecar] Startup failed:', error);
    process.exit(1);
  }
}

start();