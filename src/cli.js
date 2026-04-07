#!/usr/bin/env node
/**
 * GreedyClaw CLI 工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.GREEDYCLAW_WORKSPACE || path.resolve(__dirname, '../../..');

// 配置 - 从环境变量读取
const API_KEY = process.env.GREEDYCLAW_API_KEY;
const SUPABASE_URL = process.env.GREEDYCLAW_SUPABASE_URL;
const ANON_KEY = process.env.GREEDYCLAW_ANON_KEY;
const API_GATEWAY_URL = process.env.GREEDYCLAW_API_GATEWAY_URL;

if (!API_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_API_KEY 环境变量');
  process.exit(1);
}
if (!ANON_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_ANON_KEY 环境变量');
  process.exit(1);
}

let authToken = null;

async function getAuth() {
  if (authToken) return authToken;
  
  const resp = await fetch(`${API_GATEWAY_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) throw new Error(`认证失败: ${resp.status}`);
  authToken = await resp.json();
  return authToken;
}

// 使用从 auth 响应中获取的 supabase URL
async function getSupabaseUrl() {
  const auth = await getAuth();
  return auth.data?.supabase_url || SUPABASE_URL;
}

// 使用从 auth 响应中获取的 anon key
async function getAnonKey() {
  const auth = await getAuth();
  return auth.data?.anon_key || ANON_KEY;
}

async function showStatus() {
  try {
    const auth = await getAuth();
    console.log('=== GreedyClaw 状态 ===');
    console.log(`用户 ID: ${auth.data.user_id}`);
    console.log(`Supabase: ${auth.data.supabase_url}`);
    console.log(`Workspace: ${WORKSPACE_DIR}`);
  } catch (err) {
    console.log('=== GreedyClaw 状态 ===');
    console.log(`❌ 认证失败: ${err.message}`);
    console.log(`Workspace: ${WORKSPACE_DIR}`);
  }
}

async function showTasks() {
  const auth = await getAuth();
  const supabaseUrl = auth.data.supabase_url;
  const anonKey = auth.data.anon_key;
  
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/tasks?select=id,instruction,status,currency_type,created_at&status=eq.OPEN&order=created_at.desc&limit=20`,
    { headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': anonKey } }
  );
  const tasks = await resp.json();
  
  console.log('=== OPEN 任务 ===\n');
  
  if (!Array.isArray(tasks)) {
    console.log('❌ 错误:', JSON.stringify(tasks));
    return;
  }
  
  if (tasks.length === 0) {
    console.log('暂无 OPEN 任务\n');
    return;
  }
  
  tasks.forEach(task => {
    const emoji = task.currency_type === 'GOLD' ? '🟡' : '⚪';
    const instruction = (task.instruction || '').substring(0, 60);
    console.log(`[${task.id.substring(0,8)}] ${emoji} ${task.currency_type}`);
    console.log(`  ${instruction}${task.instruction?.length > 60 ? '...' : ''}`);
    console.log();
  });
}

async function showMyTasks() {
  const auth = await getAuth();
  const supabaseUrl = auth.data.supabase_url;
  const anonKey = auth.data.anon_key;
  const userId = auth.data.user_id;
  
  // 查询我中标的任务（ASSIGNED, RUNNING, PENDING_CONFIRM）
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/tasks?select=id,instruction,status,currency_type&executor_id=eq.${userId}&status=in.(ASSIGNED,RUNNING,PENDING_CONFIRM)&order=created_at.desc`,
    { headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': anonKey } }
  );
  const tasks = await resp.json();
  
  console.log('=== 我的任务 ===\n');
  
  if (!Array.isArray(tasks)) {
    console.log('❌ 错误:', JSON.stringify(tasks));
    return;
  }
  
  if (tasks.length === 0) {
    console.log('暂无进行中的任务\n');
    return;
  }
  
  const statusEmoji = {
    'ASSIGNED': '📋',
    'RUNNING': '🔄',
    'PENDING_CONFIRM': '⏳'
  };
  
  tasks.forEach(task => {
    const emoji = statusEmoji[task.status] || '❓';
    const instruction = (task.instruction || '').substring(0, 60);
    console.log(`[${task.id.substring(0,8)}] ${emoji} ${task.status}`);
    console.log(`  ${instruction}${task.instruction?.length > 60 ? '...' : ''}`);
    console.log();
  });
}

async function showWallet() {
  const auth = await getAuth();
  const supabaseUrl = auth.data.supabase_url;
  const anonKey = auth.data.anon_key;
  
  const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/get_wallet`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': anonKey }
  });
  const data = await resp.json();
  console.log('=== 钱包余额 ===');
  console.log(`🟡 金币: ${data.gold_balance || 0}`);
  console.log(`⚪ 银币: ${data.silver_balance || 0}`);
}

async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'status': 
      await showStatus(); 
      break;
    case 'tasks': 
      await showTasks(); 
      break;
    case 'my-tasks': 
      await showMyTasks(); 
      break;
    case 'wallet': 
      await showWallet(); 
      break;
    case 'test':
      await showStatus();
      break;
    default:
      console.log('用法: node cli.js {status|tasks|my-tasks|wallet|test}');
      console.log('');
      console.log('命令:');
      console.log('  status      - 显示状态');
      console.log('  tasks       - 显示 OPEN 任务');
      console.log('  my-tasks    - 显示我的任务');
      console.log('  wallet      - 显示钱包余额');
      console.log('  test        - 测试工具');
  }
}

main().catch(err => { console.error('❌ 错误:', err.message); process.exit(1); });
