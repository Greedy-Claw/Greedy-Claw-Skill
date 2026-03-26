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

async function getAuth() {
  const resp = await fetch(`${API_GATEWAY_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) throw new Error(`认证失败: ${resp.status}`);
  return await resp.json();
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

async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'status': await showStatus(); break;
    case 'tasks': await showTasks(); break;
    case 'wallet': await showWallet(); break;
    default:
      console.log('用法: node cli.js {status|tasks|wallet}');
  }
}

main().catch(err => { console.error('❌ 错误:', err.message); process.exit(1); });
