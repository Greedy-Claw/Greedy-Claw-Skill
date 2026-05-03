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

// 文件上传使用 multipart，JSON 用于普通 API
// 需要手动处理 multipart 以避免额外依赖
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

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
      const refreshed = await authManager.refreshIfNeeded();
      if (refreshed) {
        // JWT 已刷新，client 不变（AuthManager 内部已通过 setAuth 更新 Realtime token）
        executorId = authManager.executorId;
        console.log('[Sidecar] JWT 已刷新，Realtime token 已同步更新');
      }
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
  console.log('[Sidecar][DEBUG] GET /tasks - 获取开放任务列表');
  // get_open_tasks RPC 不存在，直接查询 tasks 表
  const { data, error } = await supabase
    .from('tasks')
    .select('id, instruction, status, owner_id, executor_id, currency_type, locked_amount, task_type, created_at')
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[Sidecar] get_open_tasks error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  console.log('[Sidecar][DEBUG] GET /tasks 返回任务数:', Array.isArray(data) ? data.length : 'N/A');
  console.log('[Sidecar][DEBUG] GET /tasks 返回数据:', JSON.stringify(data, null, 2));
  res.json(data);
});

/**
 * POST /bid
 * 提交竞标
 */
app.post('/bid', ensureAuthenticated, async (req: Request, res: Response) => {
  const { taskId, proposal, price, etaSeconds } = req.body;
  
  console.log('[Sidecar][DEBUG] POST /bid - 收到竞标请求:', JSON.stringify({ taskId, proposal, price, etaSeconds }, null, 2));
  
  if (!taskId) {
    console.log('[Sidecar][DEBUG] POST /bid - 缺少 taskId');
    return res.status(400).json({ error: 'taskId is required' });
  }
  if (price === undefined || price === null) {
    console.log('[Sidecar][DEBUG] POST /bid - 缺少 price');
    return res.status(400).json({ error: 'price is required' });
  }
  if (etaSeconds === undefined || etaSeconds === null) {
    console.log('[Sidecar][DEBUG] POST /bid - 缺少 etaSeconds');
    return res.status(400).json({ error: 'etaSeconds is required' });
  }
  
  // place_bid RPC 不存在，直接插入 bids 表
  // bids 表必填字段: task_id, price, eta_seconds
  const insertPayload: Record<string, unknown> = {
    task_id: taskId,
    price: price,
    eta_seconds: etaSeconds,
    proposal: proposal || null,
  };

  // JWT 模式下 executor_id 由 RLS/auth.uid() 自动填充
  // 直接模式下需要显式设置 executor_id
  if (executorId) {
    insertPayload.executor_id = executorId;
  }

  const { data, error } = await supabase
    .from('bids')
    .insert(insertPayload)
    .select()
    .single();
  
  if (error) {
    console.error('[Sidecar] place_bid error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  console.log('[Sidecar][DEBUG] POST /bid - 竞标结果:', JSON.stringify(data, null, 2));
  res.json(data);
});

/**
 * POST /message
 * 发送消息给雇主
 */
app.post('/message', ensureAuthenticated, async (req: Request, res: Response) => {
  const { bidId, content } = req.body;
  
  console.log('[Sidecar][DEBUG] POST /message - 收到消息请求:', JSON.stringify({ bidId, content }, null, 2));
  
  if (!bidId || !content) {
    console.log('[Sidecar][DEBUG] POST /message - 缺少必要参数:', JSON.stringify({ bidId, content }));
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
  
  console.log('[Sidecar][DEBUG] POST /message - 消息发送结果:', JSON.stringify(data, null, 2));
  res.json(data);
});

/**
 * POST /submit
 * 提交任务结果
 */
app.post('/submit', ensureAuthenticated, async (req: Request, res: Response) => {
  const { taskId, result, status, deliverySummary, deliveryMd, deliveryFilesList } = req.body;
  
  console.log('[Sidecar][DEBUG] POST /submit - 收到提交请求:', JSON.stringify({ taskId, result, status, deliverySummary, deliveryMd, deliveryFilesList }, null, 2));
  
  if (!taskId || !result) {
    console.log('[Sidecar][DEBUG] POST /submit - 缺少必要参数:', JSON.stringify({ taskId, hasResult: !!result }));
    return res.status(400).json({ error: 'taskId and result are required' });
  }
  
  // submit_task_result RPC 不存在，实际函数名为 executor_submit_result
  const { data, error } = await supabase.rpc('executor_submit_result', {
    p_task_id: taskId,
    p_result_data: result,
    p_status: status || 'PENDING_CONFIRM',
    p_delivery_summary: deliverySummary || '',
    p_delivery_md: deliveryMd || '',
    p_delivery_files_list: deliveryFilesList || [],
  });
  
  if (error) {
    console.error('[Sidecar] executor_submit_result error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  console.log('[Sidecar][DEBUG] POST /submit - 提交结果:', JSON.stringify(data, null, 2));
  res.json(data);
});

// ========================================
// 文件管理 API
// ========================================

/**
 * POST /files/upload
 * 上传文件到 task-deliveries bucket + 创建 storage_files 记录
 * 
 * Content-Type: application/json
 * Body: { bidId, fileName, fileBase64, userMetadata? }
 */
app.post('/files/upload', ensureAuthenticated, async (req: Request, res: Response) => {
  const { bidId, fileName, fileBase64, userMetadata } = req.body;

  if (!bidId || !fileName || !fileBase64) {
    return res.status(400).json({ error: 'bidId, fileName and fileBase64 are required' });
  }

  try {
    // 1. 查询 bid 获取 task_id 和 executor_id
    const { data: bid, error: bidError } = await supabase
      .from('bids')
      .select('id, task_id, executor_id, status')
      .eq('id', bidId)
      .single();

    if (bidError || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    // 2. 生成 storage_path: {task_id}/{bid_id}/executor/{filename}
    // 使用 UUID 替换原始文件名避免中文/特殊字符问题
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
    const storageFileName = crypto.randomUUID() + ext;
    const storagePath = `${bid.task_id}/${bidId}/executor/${storageFileName}`;

    // 3. 解码 base64 并上传到 Storage
    const fileBuffer = Buffer.from(fileBase64, 'base64');

    const { error: uploadError } = await supabase.storage
      .from('task-deliveries')
      .upload(storagePath, fileBuffer, {
        contentType: getContentType(fileName),
        upsert: false,
      });

    if (uploadError) {
      console.error('[Sidecar] File upload error:', uploadError);
      return res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
    }

    // 4. 创建 storage_files 记录
    const { data: fileRecord, error: insertError } = await supabase
      .from('storage_files')
      .insert({
        bid_id: bidId,
        storage_path: storagePath,
        user_metadata: {
          original_name: fileName,
          ...userMetadata,
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Sidecar] storage_files insert error:', insertError);
      // 回滚：删除已上传的文件
      await supabase.storage.from('task-deliveries').remove([storagePath]);
      return res.status(500).json({ error: `Failed to create file record: ${insertError.message}` });
    }

    console.log('[Sidecar] File uploaded:', fileRecord.id, storagePath);
    res.json({
      id: fileRecord.id,
      storagePath: fileRecord.storage_path,
      fileName: fileName,
      createdAt: fileRecord.created_at,
    });
  } catch (err: any) {
    console.error('[Sidecar] Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /files/download/:id
 * 下载文件：查 storage_files → 从 Storage 读取 → 返回文件流
 */
app.get('/files/download/:id', ensureAuthenticated, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // 1. 查询 storage_files 记录
    const { data: fileRecord, error: dbError } = await supabase
      .from('storage_files')
      .select('id, storage_path, user_metadata, file_name')
      .eq('id', id)
      .single();

    if (dbError || !fileRecord) {
      return res.status(404).json({ error: 'File record not found' });
    }

    // 2. 从 Storage 下载文件
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('task-deliveries')
      .download(fileRecord.storage_path);

    if (downloadError || !fileData) {
      console.error('[Sidecar] Storage download error:', downloadError);
      return res.status(500).json({ error: 'Failed to download file from storage' });
    }

    // 3. 设置响应头，使用原始文件名
    const originalName = (fileRecord.user_metadata as any)?.original_name
      || fileRecord.file_name
      || fileRecord.storage_path.split('/').pop()
      || 'download';

    const buffer = Buffer.from(await fileData.arrayBuffer());
    res.setHeader('Content-Type', getContentType(originalName));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    console.error('[Sidecar] Download error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /files/list
 * 列出文件：查询 storage_files 表，RLS 自动过滤
 * 
 * Query params: bidId (optional, 过滤特定 bid 的文件)
 */
app.get('/files/list', ensureAuthenticated, async (req: Request, res: Response) => {
  const { bidId } = req.query;

  try {
    let query = supabase
      .from('storage_files')
      .select('id, bid_id, storage_path, user_metadata, file_name, file_size, created_at, created_by')
      .order('created_at', { ascending: false });

    if (bidId) {
      query = query.eq('bid_id', bidId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Sidecar] List files error:', error);
      return res.status(500).json({ error: error.message });
    }

    // 转换为客户端友好的格式
    const files = (data || []).map(f => ({
      id: f.id,
      bidId: f.bid_id,
      storagePath: f.storage_path,
      fileName: (f.user_metadata as any)?.original_name || f.file_name || f.storage_path.split('/').pop(),
      fileSize: f.file_size,
      createdAt: f.created_at,
      createdBy: f.created_by,
    }));

    res.json(files);
  } catch (err: any) {
    console.error('[Sidecar] List files error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /files/delete/:id
 * 删除文件：删除 Storage 对象 + storage_files 记录
 */
app.delete('/files/delete/:id', ensureAuthenticated, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // 1. 查询 storage_files 记录
    const { data: fileRecord, error: dbError } = await supabase
      .from('storage_files')
      .select('id, storage_path')
      .eq('id', id)
      .single();

    if (dbError || !fileRecord) {
      return res.status(404).json({ error: 'File record not found' });
    }

    // 2. 删除 Storage 对象
    const { error: storageError } = await supabase.storage
      .from('task-deliveries')
      .remove([fileRecord.storage_path]);

    if (storageError) {
      console.error('[Sidecar] Storage delete error:', storageError);
      // 继续删除记录，即使 Storage 删除失败
    }

    // 3. 删除 storage_files 记录（由 service_role 执行，绕过 RLS DELETE 限制）
    // 在 direct 模式下，supabase client 是 service_role，可以直接删除
    // 在 JWT 模式下，需要通过 service_role client 删除
    // 注意：storage_files RLS 策略禁止 authenticated 用户删除
    // 但 on_storage_object_delete 触发器会在 Storage 对象被删除时自动清理
    // 所以如果 Storage 删除成功，storage_files 记录会被触发器自动删除
    // 如果 Storage 删除失败，我们仍需要手动删除记录
    if (!storageError) {
      // Storage 删除成功，触发器会自动删除 storage_files 记录
      console.log('[Sidecar] File deleted from storage, trigger will clean up storage_files record');
    } else {
      // Storage 删除失败，尝试直接删除记录
      // 注意：在 JWT 模式下，RLS 可能阻止删除
      // 使用 service_role client 时可以删除
      const { error: deleteError } = await supabase
        .from('storage_files')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('[Sidecar] storage_files delete error:', deleteError);
        return res.status(500).json({ error: 'Failed to delete file record' });
      }
    }

    console.log('[Sidecar] File deleted:', id);
    res.json({ id, deleted: true });
  } catch (err: any) {
    console.error('[Sidecar] Delete file error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 根据 filename 推断 Content-Type
 */
function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    md: 'text/markdown',
    zip: 'application/zip',
    json: 'application/json',
    csv: 'text/csv',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

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
  console.log('[Sidecar][DEBUG] pushToPlugin - 推送事件给 Plugin:', JSON.stringify({ type, data }, null, 2));
  try {
    const response = await fetch(PLUGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    });
    
    if (!response.ok) {
      console.error('[Sidecar] pushToPlugin failed:', response.status, response.statusText);
    } else {
      console.log('[Sidecar][DEBUG] pushToPlugin - 推送成功, HTTP', response.status);
    }
  } catch (error) {
    console.error('[Sidecar] pushToPlugin error:', (error as Error).message);
  }
}

/**
 * 设置 Realtime 监听
 */
async function setupRealtimeListeners(): Promise<void> {
  console.log('[Sidecar][DEBUG] setupRealtimeListeners - 开始设置 Realtime 监听');

  // 先移除旧的 channel 监听，避免重复订阅
  // 注意：removeAllChannels 是异步的，必须 await 等待所有 channel 完全取消订阅并断开 WebSocket
  try {
    await supabase.removeAllChannels();
    console.log('[Sidecar][DEBUG] 已移除旧的 Realtime channels');
  } catch {
    // 忽略错误
  }

  // 监听新任务
  supabase
    .channel('tasks-channel')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'tasks' }, 
      (payload) => {
        console.log('[Sidecar][DEBUG] Realtime 收到新任务 (INSERT tasks):', JSON.stringify(payload.new, null, 2));
        console.log('[Sidecar] new_task:', payload.new.id);
        pushToPlugin('new_task', payload.new as EventData);
      }
    )
    .subscribe((status) => {
      console.log('[Sidecar][DEBUG] tasks-channel 订阅状态:', status);
    });

  // 监听 bid 状态变化（仅在 status 真正变更时推送）
  supabase
    .channel('bids-channel')
    .on('postgres_changes', 
      { event: 'UPDATE', schema: 'public', table: 'bids' }, 
      (payload) => {
        const newBid = payload.new as EventData;
        const oldStatus = (payload.old as EventData)?.status;
        const newStatus = newBid.status;

        console.log('[Sidecar][DEBUG] Realtime 收到 bid 更新 (UPDATE bids):', JSON.stringify(payload.new, null, 2));
        console.log('[Sidecar][DEBUG] Realtime bid 旧值:', JSON.stringify(payload.old, null, 2));
        console.log('[Sidecar] bid update:', newBid.id, '→', newStatus, '(oldStatus:', oldStatus, ')');

        // 只在 status 真正变更时才推送事件，忽略其他字段的更新
        if (oldStatus === newStatus) {
          console.log('[Sidecar][DEBUG] bid status 未变化，忽略此更新');
          return;
        }

        // 统一使用 bid_status_changed 事件，payload 中包含 status 字段
        // 所有状态变更都转发：PENDING / SHORTLISTED / ACCEPTED / CANCELLED / OUTDATED
        pushToPlugin('bid_status_changed', newBid);
      }
    )
    .subscribe((status) => {
      console.log('[Sidecar][DEBUG] bids-channel 订阅状态:', status);
    });

  // 监听新消息 (bids_messages) —— 过滤掉自己发出的消息，避免回声
  supabase
    .channel('bids-messages-channel')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'bids_messages' }, 
      async (payload) => {
        const msg = payload.new as EventData;
        console.log('[Sidecar][DEBUG] Realtime 收到新消息 (INSERT bids_messages):', JSON.stringify(msg, null, 2));

        // 过滤掉自己发出的消息，避免回声环路
        if (executorId && msg.sender_id === executorId) {
          console.log('[Sidecar][DEBUG] 忽略自己发送的消息, sender_id:', msg.sender_id);
          return;
        }

        // bids_messages 只有 bid_id，需要关联 bids 表获取 task_id，
        // 以便 Plugin 侧用 task_id 作为 sessionKey 关联到同一任务的对话
        if (msg.bid_id && !msg.task_id) {
          const { data: bid } = await supabase
            .from('bids')
            .select('task_id')
            .eq('id', msg.bid_id)
            .single();
          if (bid?.task_id) {
            msg.task_id = bid.task_id;
          }
        }

        console.log('[Sidecar] new_message:', msg.id, 'task_id:', msg.task_id);
        pushToPlugin('new_message', msg);
      }
    )
    .subscribe((status) => {
      console.log('[Sidecar][DEBUG] bids-messages-channel 订阅状态:', status);
    });
}

// ========================================
// JWT 定时刷新机制：在过期前主动刷新
// ========================================
const JWT_REFRESH_INTERVAL_MS = 55 * 60_000; // 每 55 分钟检查一次（JWT 默认 1 小时过期，留 5 分钟缓冲）
let jwtRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function refreshJwtIfNeeded(): Promise<void> {
  if (!authManager) return;

  try {
    const refreshed = await authManager.refreshIfNeeded();
    if (refreshed) {
      executorId = authManager.executorId;
      // JWT 刷新后 Realtime channel 可能已被服务端断开，需要重建订阅
      await setupRealtimeListeners();
      console.log('[Sidecar] JWT 定时刷新成功，Realtime 已重新订阅');
    }
  } catch (error) {
    console.error('[Sidecar] JWT 定时刷新失败:', error);
  }
}

function startJwtRefreshTimer(): void {
  if (!authManager) return; // 直接模式不需要

  // 首次延迟 55 分钟后执行
  jwtRefreshTimer = setInterval(refreshJwtIfNeeded, JWT_REFRESH_INTERVAL_MS);

  // 防止定时器阻止进程退出
  if (jwtRefreshTimer && typeof jwtRefreshTimer === 'object' && 'unref' in jwtRefreshTimer) {
    jwtRefreshTimer.unref();
  }

  console.log(`[Sidecar] JWT 定时刷新已启动，间隔 ${JWT_REFRESH_INTERVAL_MS / 60_000} 分钟`);
}

function stopJwtRefreshTimer(): void {
  if (jwtRefreshTimer) {
    clearInterval(jwtRefreshTimer);
    jwtRefreshTimer = null;
  }
}

// ========================================
// 心跳机制：每 60 秒向 heartbeat_buffer 表写入一条记录
// ========================================
const HEARTBEAT_INTERVAL_MS = 60_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function sendHeartbeat(): Promise<void> {
  if (!executorId) {
    console.log('[Sidecar] 心跳跳过：executorId 未就绪');
    return;
  }

  try {
    const { error } = await supabase
      .from('heartbeat_buffer')
      .insert({ node_id: executorId });

    if (error) {
      // JWT 过期时立即刷新并重试一次
      if (isJwtExpiredError(error) && authManager) {
        console.log('[Sidecar] 心跳检测到 JWT 过期，立即刷新...');
        await authManager.refreshIfNeeded();
        // JWT 刷新后 Realtime channel 可能已被断开，重建订阅
        await setupRealtimeListeners();
        const retry = await supabase
          .from('heartbeat_buffer')
          .insert({ node_id: executorId });
        if (retry.error) throw retry.error;
        console.log('[Sidecar] 💓 心跳已发送（刷新后重试成功）');
      } else {
        throw error;
      }
    } else {
      console.log('[Sidecar] 💓 心跳已发送');
    }
  } catch (err) {
    console.log(`[Sidecar] 心跳发送失败: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
  }
}

/**
 * 检测是否为 JWT 过期错误
 */
function isJwtExpiredError(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST303' || 
    (error.message?.includes('JWT expired') ?? false);
}

function startHeartbeat(): void {
  // 立即发送一次
  sendHeartbeat();

  // 定时发送
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  // 防止定时器阻止进程退出（sidecar 作为子进程，由 plugin 管理生命周期）
  if (heartbeatTimer && typeof heartbeatTimer === 'object' && 'unref' in heartbeatTimer) {
    heartbeatTimer.unref();
  }
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ========================================
// 启动服务
// ========================================
async function start(): Promise<void> {
  try {
    await initializeSupabase();
    await setupRealtimeListeners();
    startHeartbeat();
    startJwtRefreshTimer();
    
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

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Sidecar] 收到 SIGTERM，正在关闭...');
  stopHeartbeat();
  stopJwtRefreshTimer();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Sidecar] 收到 SIGINT，正在关闭...');
  stopHeartbeat();
  stopJwtRefreshTimer();
  process.exit(0);
});

start();