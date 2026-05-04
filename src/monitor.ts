/**
 * GreedyClaw Monitor — Supabase Realtime 监听 + 心跳 + JWT 刷新
 *
 * 参考 Weixin 的 monitorWeixinProvider：
 * - 长驻 async 函数，运行在主进程内
 * - 通过 abortSignal 控制生命周期
 * - 不再需要 sidecar 子进程
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { AuthManager } from './auth/AuthManager.js';
import { getSupabase, setSupabase, getAuthManager, setAuthManager, getExecutorId, setExecutorId } from './state.js';

// ========================================
// 类型
// ========================================
export interface EventData {
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

type EventCallback = (type: string, data: EventData) => Promise<void>;

// ========================================
// 全局事件回调引用（供心跳中 JWT 过期重订阅使用）
// ========================================
let _currentOnEvent: EventCallback | null = null;

// ========================================
// 配置
// ========================================
const HEARTBEAT_INTERVAL_MS = 60_000;
const JWT_REFRESH_INTERVAL_MS = 55 * 60_000;

// ========================================
// Supabase 初始化
// ========================================
interface InitOpts {
  authMode: string;
  apiKey?: string;
  apiGatewayUrl?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

export async function initializeSupabase(opts: InitOpts): Promise<void> {
  const { authMode, apiKey, apiGatewayUrl, supabaseUrl, supabaseKey } = opts;

  if (authMode === 'jwt' && apiKey && apiGatewayUrl) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        '[GreedyClaw] JWT mode requires supabaseUrl and supabaseKey (anon key) in config. ' +
        'API Gateway no longer returns these fields.',
      );
    }

    console.log('[GreedyClaw] 使用 JWT 认证模式');

    const authManager = new AuthManager({
      apiKey,
      apiGatewayUrl,
      supabaseUrl,
      anonKey: supabaseKey,
    });

    await authManager.authenticate();
    setSupabase(authManager.client);
    setAuthManager(authManager);
    setExecutorId(authManager.executorId);

    console.log(`[GreedyClaw] 已认证用户: ${authManager.executorId}`);
  } else if (supabaseUrl && supabaseKey) {
    console.log('[GreedyClaw] 使用直接认证模式（开发环境）');

    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    setSupabase(client);
    setAuthManager(null);
    setExecutorId(null);

    console.log('[GreedyClaw] Supabase 连接成功（无用户身份）');
  } else {
    throw new Error(
      '[GreedyClaw] Missing required config. ' +
      'JWT mode requires: apiKey, apiGatewayUrl. ' +
      'Direct mode requires: supabaseUrl, supabaseKey.',
    );
  }
}

// ========================================
// Realtime 监听
// ========================================
export async function setupRealtimeListeners(
  onEvent: EventCallback,
): Promise<void> {
  const supabase = getSupabase();
  const executorId = getExecutorId();

  try {
    await supabase.removeAllChannels();
    console.log('[GreedyClaw] 已移除旧的 Realtime channels');
  } catch {
    // 忽略
  }

  // 监听新任务
  supabase
    .channel('tasks-channel')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tasks' },
      (payload) => {
        console.log('[GreedyClaw] new_task:', payload.new.id);
        onEvent('new_task', payload.new as EventData);
      },
    )
    .subscribe((status) => {
      console.log('[GreedyClaw] tasks-channel 订阅状态:', status);
    });

  // 监听 bid 状态变化
  supabase
    .channel('bids-channel')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'bids' },
      (payload) => {
        const newBid = payload.new as EventData;
        const oldStatus = (payload.old as EventData)?.status;
        const newStatus = newBid.status;

        if (oldStatus === newStatus) return;

        console.log('[GreedyClaw] bid_status_changed:', newBid.id, '→', newStatus);
        onEvent('bid_status_changed', newBid);
      },
    )
    .subscribe((status) => {
      console.log('[GreedyClaw] bids-channel 订阅状态:', status);
    });

  // 监听新消息
  supabase
    .channel('bids-messages-channel')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bids_messages' },
      async (payload) => {
        const msg = payload.new as EventData;

        // 过滤掉自己发出的消息
        if (executorId && msg.sender_id === executorId) return;

        // 关联 task_id
        if (msg.bid_id && !msg.task_id) {
          try {
            const { data: bid } = await supabase
              .from('bids')
              .select('task_id')
              .eq('id', msg.bid_id)
              .single();
            if (bid?.task_id) msg.task_id = bid.task_id;
          } catch {
            // 忽略
          }
        }

        console.log('[GreedyClaw] new_message:', msg.id, 'task_id:', msg.task_id);
        onEvent('new_message', msg);
      },
    )
    .subscribe((status) => {
      console.log('[GreedyClaw] bids-messages-channel 订阅状态:', status);
    });
}

// ========================================
// 心跳
// ========================================
async function sendHeartbeat(): Promise<void> {
  const supabase = getSupabase();
  const executorId = getExecutorId();
  const authManager = getAuthManager();

  if (!executorId) return;

  try {
    const { error } = await supabase
      .from('heartbeat_buffer')
      .insert({ node_id: executorId });

    if (error) {
      if (isJwtExpiredError(error) && authManager) {
        console.log('[GreedyClaw] 心跳检测到 JWT 过期，刷新...');
        await authManager.refreshIfNeeded();
        setExecutorId(authManager.executorId);
        await setupRealtimeListeners(_currentOnEvent!);
        const retry = await supabase
          .from('heartbeat_buffer')
          .insert({ node_id: executorId });
        if (retry.error) throw retry.error;
        console.log('[GreedyClaw] 心跳已发送（刷新后重试成功）');
      } else {
        throw error;
      }
    } else {
      console.log('[GreedyClaw] 心跳已发送');
    }
  } catch (err) {
    console.log(`[GreedyClaw] 心跳发送失败: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
  }
}

function isJwtExpiredError(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST303' || (error.message?.includes('JWT expired') ?? false);
}

// ========================================
// 主 monitor 函数
// ========================================
export interface MonitorOpts {
  onEvent: EventCallback;
  abortSignal: AbortSignal;
}

export async function monitorGreedyClaw(opts: MonitorOpts): Promise<void> {
  const { onEvent, abortSignal } = opts;
  const authManager = getAuthManager();

  _currentOnEvent = onEvent;

  console.log('[GreedyClaw] Monitor 启动');

  // 1. 设置 Realtime 监听
  await setupRealtimeListeners(onEvent);

  // 2. 心跳循环
  sendHeartbeat();

  // 3. 主循环：心跳 + JWT 刷新
  let lastHeartbeat = Date.now();
  let lastJwtCheck = Date.now();

  while (!abortSignal.aborted) {
    await sleep(5_000, abortSignal);
    if (abortSignal.aborted) break;

    const now = Date.now();

    // 心跳
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      await sendHeartbeat();
      lastHeartbeat = now;
    }

    // JWT 刷新
    if (authManager && now - lastJwtCheck >= JWT_REFRESH_INTERVAL_MS) {
      try {
        const refreshed = await authManager.refreshIfNeeded();
        if (refreshed) {
          setExecutorId(authManager.executorId);
          await setupRealtimeListeners(onEvent);
          console.log('[GreedyClaw] JWT 刷新成功，Realtime 已重新订阅');
        }
      } catch (err) {
        console.error('[GreedyClaw] JWT 刷新失败:', err);
      }
      lastJwtCheck = now;
    }
  }

  // 清理
  try {
    const supabase = getSupabase();
    await supabase.removeAllChannels();
  } catch {
    // 忽略
  }

  console.log('[GreedyClaw] Monitor 已停止');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => { clearTimeout(t); reject(new Error('aborted')); },
      { once: true },
    );
  });
}
