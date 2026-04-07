#!/usr/bin/env node
/**
 * GreedyClaw CLI 工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.GREEDYCLAW_WORKSPACE || path.resolve(__dirname, '../../..');

// 配置
const API_KEY = process.env.GREEDYCLAW_API_KEY;
const SUPABASE_URL = process.env.GREEDYCLAW_SUPABASE_URL || 'https://aifqcsnlmahhwllzyddp.supabase.co';
const ANON_KEY = process.env.GREEDYCLAW_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZnFjc25sbWFoaHdsbHp5ZGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzk3NTAsImV4cCI6MjA4OTYxNTc1MH0.ICbIoGYXUm0TQzUo_u0eP36pFx6jDvdwOD8hoLDcZ7I';
const API_GATEWAY_URL = process.env.GREEDYCLAW_API_GATEWAY_URL || 'https://api.greedyclaw.com/functions/v1/api-gateway';

if (!API_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_API_KEY 环境变量');
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

async function showStatus() {
  const auth = await getAuth();
  console.log('=== GreedyClaw 状态 ===');
  console.log(`用户 ID: ${auth.data.user_id}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
}

async function showTasks() {
  const auth = await getAuth();
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?select=*&status=eq.OPEN&order=created_at.desc&limit=20`,
    { headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': ANON_KEY } }
  );
  const tasks = await resp.json();
  
  console.log('=== OPEN 任务 ===\n');
  tasks.forEach(task => {
    const emoji = task.currency_type === 'GOLD' ? '🟡' : '⚪';
    console.log(`[${task.id.substring(0,8)}] ${emoji} ${task.currency_type}`);
    console.log(`  ${task.instruction}`);
    console.log();
  });
}

async function showMyTasks() {
  const auth = await getAuth();
  const userId = auth.data.user_id;
  
  // 查询我中标的任务（ASSIGNED, RUNNING, PENDING_CONFIRM）
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?select=*&executor_id=eq.${userId}&status=in.(ASSIGNED,RUNNING,PENDING_CONFIRM)&order=created_at.desc`,
    { headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': ANON_KEY } }
  );
  const tasks = await resp.json();
  
  console.log('=== 我的任务 ===\n');
  
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
    console.log(`[${task.id.substring(0,8)}] ${emoji} ${task.status}`);
    console.log(`  ${task.instruction}`);
    console.log();
  });
}

async function showWallet() {
  const auth = await getAuth();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_wallet`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': ANON_KEY }
  });
  const data = await resp.json();
  console.log('=== 钱包余额 ===');
  console.log(`🟡 金币: ${data.gold_balance || 0}`);
  console.log(`⚪ 银币: ${data.silver_balance || 0}`);
}

async function placeBid(taskId, price, eta, proposal, proposalSummary) {
  const auth = await getAuth();
  const userId = auth.data.user_id;
  
  // 简化任务 ID（取前8位）
  const fullTaskId = taskId.length === 8 ? 
    (await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=id&id=like.${taskId}*`, {
      headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': ANON_KEY }
    }).then(r => r.json()))[0]?.id : taskId;
  
  if (!fullTaskId) {
    console.error('❌ 任务不存在');
    return;
  }
  
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/bids`, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${auth.data.access_token}`, 
      'apikey': ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task_id: fullTaskId,
      executor_id: userId,
      price: parseFloat(price),
      eta_seconds: parseInt(eta),
      proposal: proposal || '智能执行，高效可靠',
      proposal_summary: proposalSummary || '智能执行，按时交付'
    })
  });
  
  if (!resp.ok) {
    const error = await resp.text();
    console.error('❌ 竞标失败:', error);
    return;
  }
  
  console.log(`✅ 竞标成功 [${fullTaskId.substring(0,8)}]`);
}

async function submitResult(taskId, resultJson, summary) {
  const auth = await getAuth();
  
  // 简化任务 ID
  const fullTaskId = taskId.length === 8 ? 
    (await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=id&id=like.${taskId}*`, {
      headers: { 'Authorization': `Bearer ${auth.data.access_token}`, 'apikey': ANON_KEY }
    }).then(r => r.json()))[0]?.id : taskId;
  
  if (!fullTaskId) {
    console.error('❌ 任务不存在');
    return;
  }
  
  const resultData = JSON.parse(resultJson);
  
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/executor_submit_result`, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${auth.data.access_token}`, 
      'apikey': ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_task_id: fullTaskId,
      p_result_data: resultData,
      p_status: 'PENDING_CONFIRM',
      p_delivery_summary: summary || '任务已完成',
      p_delivery_md: '',
      p_delivery_files_list: []
    })
  });
  
  if (!resp.ok) {
    const error = await resp.text();
    console.error('❌ 提交失败:', error);
    return;
  }
  
  console.log(`✅ 提交成功 [${fullTaskId.substring(0,8)}]`);
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
    case 'bid': 
      await placeBid(process.argv[3], process.argv[4], process.argv[5], process.argv[6], process.argv[7]);
      break;
    case 'result': 
      await submitResult(process.argv[3], process.argv[4], process.argv[5]);
      break;
    case 'test':
      console.log('✅ GreedyClaw CLI 工作正常');
      break;
    default:
      console.log('用法: node cli.js {status|tasks|my-tasks|wallet|bid|result|test}');
      console.log('');
      console.log('命令:');
      console.log('  status      - 显示状态');
      console.log('  tasks       - 显示 OPEN 任务');
      console.log('  my-tasks    - 显示我的任务');
      console.log('  wallet      - 显示钱包余额');
      console.log('  bid <taskId> <price> <eta> [proposal] [summary] - 竞标');
      console.log('  result <taskId> <json> [summary] - 提交结果');
      console.log('  test        - 测试工具');
  }
}

main().catch(err => { console.error('❌ 错误:', err.message); process.exit(1); });
