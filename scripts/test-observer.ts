#!/usr/bin/env npx tsx
/**
 * 独立测试 Observer 脚本
 * 
 * 用法:
 *   npx tsx scripts/test-observer.ts
 * 
 * 功能:
 *   - 从 .env 读取配置
 *   - 通过 API Gateway 认证获取 JWT
 *   - 启动 Supabase Realtime 监听 + 轮询
 *   - 打印所有收到的事件（新任务、中标、消息）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ========== .env 加载 ==========
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) {
    console.error('错误: .env 文件不存在，请复制 .env.example 并填写配置');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    env[key] = value;
    process.env[key] = value;
  }
  return env;
}

// ========== 认证 ==========
interface AuthResponse {
  data: {
    access_token: string;
    user_id: string;
    supabase_url: string;
    anon_key: string;
  };
}

async function authenticate(apiKey: string, apiGatewayUrl: string): Promise<{
  accessToken: string;
  userId: string;
  supabaseUrl: string;
  anonKey: string;
}> {
  console.log(`正在认证... ${apiGatewayUrl}/auth/token`);
  
  const response = await fetch(`${apiGatewayUrl}/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`认证失败: HTTP ${response.status} - ${text}`);
  }

  const json = (await response.json()) as AuthResponse;
  
  // 解码 JWT 查看 payload
  try {
    const payload = JSON.parse(Buffer.from(json.data.access_token.split('.')[1], 'base64').toString());
    console.log(`JWT payload:`);
    console.log(`  sub:          ${payload.sub}`);
    console.log(`  role:         ${payload.role}`);
    console.log(`  exp:          ${new Date(payload.exp * 1000).toISOString()}`);
    console.log(`  iat:          ${new Date(payload.iat * 1000).toISOString()}`);
  } catch (e) {
    console.log('无法解码 JWT payload');
  }

  console.log(`认证成功!`);
  console.log(`  User ID:    ${json.data.user_id}`);
  console.log(`  Supabase:   ${json.data.supabase_url}`);
  console.log(`  Token:      ${json.data.access_token.substring(0, 20)}...`);
  
  return {
    accessToken: json.data.access_token,
    userId: json.data.user_id,
    supabaseUrl: json.data.supabase_url,
    anonKey: json.data.anon_key,
  };
}

// ========== 创建 Supabase 客户端 ==========
function createAuthenticatedClient(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
): SupabaseClient {
  const client = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  // 关键：为 Realtime WebSocket 设置 JWT
  client.realtime.setAuth(accessToken);
  return client;
}

// ========== 首次数据查询 ==========
async function queryInitialData(client: SupabaseClient, executorId: string) {
  console.log('\n========== 首次数据查询 ==========');

  // 1. 查询我的任务
  const { data: myTasks, error: taskErr } = await client
    .from('tasks')
    .select('id, status, instruction, executor_id, owner_id')
    .or(`executor_id.eq.${executorId},owner_id.eq.${executorId}`)
    .order('created_at', { ascending: false })
    .limit(10);

  if (taskErr) {
    console.log(`❌ 查询我的任务失败: ${taskErr.message}`);
  } else {
    console.log(`📋 我的任务 (${myTasks?.length || 0}):`);
    for (const t of myTasks || []) {
      console.log(`   [${t.status}] ${t.id.substring(0, 8)}... ${(t.instruction || '').substring(0, 40)}`);
    }
  }

  // 2. 查询 OPEN 任务
  const { data: openTasks, error: openErr } = await client
    .from('tasks')
    .select('id, status, instruction')
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false })
    .limit(5);

  if (openErr) {
    console.log(`❌ 查询 OPEN 任务失败: ${openErr.message}`);
  } else {
    console.log(`📋 OPEN 任务 (${openTasks?.length || 0}):`);
    for (const t of openTasks || []) {
      console.log(`   ${t.id.substring(0, 8)}... ${(t.instruction || '').substring(0, 40)}`);
    }
  }

  // 3. 查询我能看到的消息
  if (myTasks && myTasks.length > 0) {
    const taskIds = myTasks.map(t => t.id);
    const { data: messages, error: msgErr } = await client
      .from('task_messages')
      .select('*')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .limit(20);

    if (msgErr) {
      console.log(`❌ 查询消息失败: ${msgErr.message}`);
    } else {
      console.log(`💬 我的消息 (${messages?.length || 0}):`);
      for (const m of messages || []) {
        const isMine = m.sender_id === executorId;
        console.log(`   ${isMine ? '→' : '←'} [${m.task_id.substring(0, 8)}] ${(m.content || '').substring(0, 50)} (${m.created_at})`);
      }
    }
  }

  // 4. 查询 NEGOTIATING 任务的消息
  const { data: negTasks } = await client
    .from('tasks')
    .select('id')
    .eq('executor_id', executorId)
    .eq('status', 'NEGOTIATING');

  if (negTasks && negTasks.length > 0) {
    const taskIds = negTasks.map(t => t.id);
    const { data: negMessages, error: negMsgErr } = await client
      .from('task_messages')
      .select('*')
      .in('task_id', taskIds)
      .neq('sender_id', executorId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (negMsgErr) {
      console.log(`❌ 查询 NEGOTIATING 消息失败: ${negMsgErr.message}`);
    } else {
      console.log(`💬 NEGOTIATING 任务的未读消息 (${negMessages?.length || 0}):`);
      for (const m of negMessages || []) {
        console.log(`   ← [${m.task_id.substring(0, 8)}] ${(m.content || '').substring(0, 60)}`);
      }
    }
  }

  console.log('=====================================\n');
}

// ========== Observer ==========
function startObserver(client: SupabaseClient, executorId: string) {
  const notifiedTasks = new Set<string>();
  const notifiedMessages = new Set<string>();

  // 1. 监听新任务 INSERT
  const tasksChannel = client
    .channel('test-tasks-insert')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tasks',
        filter: 'status=eq.OPEN',
      },
      (payload) => {
        const task = payload.new as Record<string, unknown>;
        if (notifiedTasks.has(task.id as string)) return;
        notifiedTasks.add(task.id as string);
        console.log('\n📥 [Realtime-新任务] ========================');
        console.log(`  ID:          ${task.id}`);
        console.log(`  描述:        ${(task.instruction as string)?.substring(0, 80)}`);
        console.log(`  状态:        ${task.status}`);
        console.log(`  货币类型:    ${task.currency_type}`);
        console.log(`  锁定金额:    ${task.locked_amount || '未指定'}`);
        console.log(`  任务类型:    ${task.task_type}`);
        console.log('============================================\n');
      }
    )
    .subscribe((status, err) => {
      console.log(`[tasks-insert] channel 状态: ${status}${err ? ` error: ${err.message}` : ''}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`❌ [tasks-insert] 订阅异常: ${status}`);
      }
    });

  // 2. 监听任务 UPDATE（中标检测）
  const updateChannel = client
    .channel('test-tasks-update')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tasks',
      },
      (payload) => {
        const newTask = payload.new as Record<string, unknown>;
        const oldTask = payload.old as Record<string, unknown>;
        if (newTask.executor_id === executorId && oldTask.executor_id !== executorId) {
          console.log('\n🎉 [Realtime-中标] ========================');
          console.log(`  ID:          ${newTask.id}`);
          console.log(`  描述:        ${(newTask.instruction as string)?.substring(0, 80)}`);
          console.log(`  状态:        ${newTask.status}`);
          console.log('============================================\n');
        } else {
          console.log(`[tasks-update] task ${(newTask.id as string)?.substring(0, 8)} status=${newTask.status} executor=${(newTask.executor_id as string)?.substring(0, 8)}`);
        }
      }
    )
    .subscribe((status, err) => {
      console.log(`[tasks-update] channel 状态: ${status}${err ? ` error: ${err.message}` : ''}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`❌ [tasks-update] 订阅异常: ${status}`);
      }
    });

  // 3. 监听新消息 ★★★ 重点测试 ★★★
  const messagesChannel = client
    .channel('test-task-messages')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'task_messages',
      },
      (payload) => {
        const msg = payload.new as Record<string, unknown>;
        console.log('\n💬 [Realtime-新消息] ======================');
        console.log(`  消息 ID:     ${msg.id}`);
        console.log(`  任务 ID:     ${msg.task_id}`);
        console.log(`  发送者 ID:   ${msg.sender_id}`);
        console.log(`  是否自己:    ${msg.sender_id === executorId}`);
        console.log(`  内容:        ${(msg.content as string)?.substring(0, 200)}`);
        console.log(`  创建时间:    ${msg.created_at}`);
        console.log('=============================================\n');

        if (msg.sender_id === executorId) {
          console.log(`  (忽略自己的消息)`);
          return;
        }
        if (notifiedMessages.has(msg.id as string)) {
          console.log(`  (去重: 已通知过)`);
          return;
        }
        notifiedMessages.add(msg.id as string);
      }
    )
    .subscribe((status, err) => {
      console.log(`[task-messages] channel 状态: ${status}${err ? ` error: ${err.message}` : ''}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`❌ [task-messages] 订阅异常: ${status}`);
      }
    });

  // 4. Realtime 连接状态监控
  const connState = client.realtime.connectionState();
  console.log(`[Realtime] 初始连接状态: ${connState}`);

  // 5. 轮询备份（每 15 秒）
  const pollIntervalId = setInterval(async () => {
    try {
      // 轮询 OPEN 任务
      const { data: openTasks, error: openErr } = await client
        .from('tasks')
        .select('*')
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(5);

      if (openErr) {
        console.log(`[轮询] OPEN 任务查询失败: ${openErr.message}`);
      } else if (openTasks) {
        for (const task of openTasks) {
          if (!notifiedTasks.has(task.id)) {
            notifiedTasks.add(task.id);
            console.log('\n📥 [轮询-新任务] ============================');
            console.log(`  ID:          ${task.id}`);
            console.log(`  描述:        ${task.instruction?.substring(0, 80)}`);
            console.log('=============================================\n');
          }
        }
      }

      // 轮询 NEGOTIATING 任务的消息
      const { data: negotiatingTasks, error: negErr } = await client
        .from('tasks')
        .select('id')
        .eq('executor_id', executorId)
        .eq('status', 'NEGOTIATING');

      // 轮询 ASSIGNED/RUNNING 任务的消息
      const { data: activeTasks, error: activeErr } = await client
        .from('tasks')
        .select('id')
        .eq('executor_id', executorId)
        .in('status', ['ASSIGNED', 'RUNNING']);

      const allTaskIds = [
        ...(negotiatingTasks || []).map(t => t.id),
        ...(activeTasks || []).map(t => t.id),
      ];

      if (allTaskIds.length > 0) {
        const { data: newMessages, error: msgErr } = await client
          .from('task_messages')
          .select('*')
          .in('task_id', allTaskIds)
          .neq('sender_id', executorId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (msgErr) {
          console.log(`[轮询] 消息查询失败: ${msgErr.message}`);
        } else if (newMessages) {
          for (const msg of newMessages) {
            if (!notifiedMessages.has(msg.id)) {
              notifiedMessages.add(msg.id);
              console.log('\n💬 [轮询-新消息] ============================');
              console.log(`  消息 ID:     ${msg.id}`);
              console.log(`  任务 ID:     ${msg.task_id}`);
              console.log(`  发送者 ID:   ${msg.sender_id}`);
              console.log(`  内容:        ${msg.content?.substring(0, 200)}`);
              console.log('=============================================\n');
            }
          }
        }
      }

      const connStateNow = client.realtime.connectionState();
      console.log(`[轮询] 完成 - OPEN:${openTasks?.length || 0} NEG:${negotiatingTasks?.length || 0} ACTIVE:${activeTasks?.length || 0} Realtime:${connStateNow}`);
    } catch (error) {
      console.error(`[轮询] 异常: ${(error as Error).message}`);
    }
  }, 15000);

  return {
    channels: [tasksChannel, updateChannel, messagesChannel],
    pollIntervalId,
    stop() {
      for (const ch of [tasksChannel, updateChannel, messagesChannel]) {
        ch.unsubscribe();
      }
      clearInterval(pollIntervalId);
      console.log('Observer 已停止');
    },
  };
}

// ========== 主函数 ==========
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   GreedyClaw Observer 独立测试            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 1. 加载配置
  const env = loadEnv();
  const apiKey = env.GREEDYCLAW_API_KEY;
  const apiGatewayUrl = env.GREEDYCLAW_API_GATEWAY_URL;

  if (!apiKey) {
    console.error('错误: 请在 .env 中设置 GREEDYCLAW_API_KEY');
    process.exit(1);
  }

  console.log('配置:');
  console.log(`  API Gateway: ${apiGatewayUrl}`);
  console.log(`  API Key:     ${apiKey.substring(0, 15)}...`);
  console.log();

  // 2. 认证
  const auth = await authenticate(apiKey, apiGatewayUrl!);
  console.log();

  // 3. 创建 Supabase 客户端
  const client = createAuthenticatedClient(auth.supabaseUrl, auth.anonKey, auth.accessToken);
  console.log('Supabase 客户端已创建');
  console.log();

  // 4. 首次数据查询
  await queryInitialData(client, auth.userId);

  // 5. 启动 Observer
  console.log('启动 Observer 监听...');
  const observer = startObserver(client, auth.userId);

  console.log('\n✅ Observer 已启动，等待事件...');
  console.log('   按 Ctrl+C 退出\n');

  // 6. 优雅退出
  const cleanup = () => {
    console.log('\n正在停止...');
    observer.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
