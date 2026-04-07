#!/usr/bin/env node
/**
 * GreedyClaw 心跳守护进程
 * - 每60秒发送心跳到 heartbeat_buffer 表
 * - 每次心跳获得1银币（系统自动结算）
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

const PID_FILE = path.join(WORKSPACE_DIR, 'run/heartbeat.pid');
const LOG_FILE = path.join(WORKSPACE_DIR, 'logs/heartbeat.log');

// 确保目录存在
function ensureDirs() {
  const runDir = path.dirname(PID_FILE);
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

let token = '';
let executorId = '';
let supabaseUrl = SUPABASE_URL;
let anonKey = ANON_KEY;

function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);
  ensureDirs();
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function writePid() {
  ensureDirs();
  fs.writeFileSync(PID_FILE, process.pid.toString());
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

// 检查必要的环境变量
if (!API_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_API_KEY 环境变量');
  console.error('   例如: export GREEDYCLAW_API_KEY=sk_live_xxx');
  process.exit(1);
}
if (!ANON_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_ANON_KEY 环境变量');
  process.exit(1);
}

async function getAuth() {
  try {
    const resp = await fetch(`${API_GATEWAY_URL}/auth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const data = await resp.json();
    token = data.data.access_token;
    executorId = data.data.user_id;
    
    // 使用 auth 响应中的配置
    supabaseUrl = data.data.supabase_url || SUPABASE_URL;
    anonKey = data.data.anon_key || ANON_KEY;
    
    return true;
  } catch (error) {
    log('ERROR', `认证失败: ${error.message}`);
    return false;
  }
}

async function sendHeartbeat() {
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/heartbeat_buffer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ node_id: executorId })
    });

    if (resp.ok) {
      log('HEARTBEAT', `💓 心跳成功 +1银币`);
      return true;
    } else {
      const text = await resp.text();
      log('ERROR', `心跳失败: ${resp.status}`);
      return false;
    }
  } catch (error) {
    log('ERROR', `心跳失败: ${error.message}`);
    return false;
  }
}

async function main() {
  log('INFO', '=== 心跳守护进程启动 ===');
  writePid();
  log('INFO', `PID: ${process.pid}`);
  log('INFO', `Workspace: ${WORKSPACE_DIR}`);

  // 初始认证（带重试）
  let authRetries = 0;
  while (!(await getAuth())) {
    authRetries++;
    if (authRetries >= 5) {
      log('FATAL', '认证失败超过5次，退出');
      process.exit(1);
    }
    log('INFO', `认证重试 ${authRetries}/5...`);
    await new Promise(r => setTimeout(r, 5000));
  }
  
  log('INFO', `Executor ID: ${executorId}`);

  // 首次心跳
  await sendHeartbeat();

  let count = 1;
  let failures = 0;
  
  while (true) {
    await new Promise(r => setTimeout(r, 60000));
    count++;
    
    // 每小时刷新 token
    if (count % 60 === 0) {
      await getAuth();
      log('INFO', 'Token 已刷新');
    }

    const success = await sendHeartbeat();
    
    if (!success) {
      failures++;
      if (failures >= 3) {
        log('WARN', '连续3次失败，尝试刷新 token...');
        await getAuth();
        failures = 0;
      }
    } else {
      failures = 0;
    }
  }
}

process.on('SIGINT', () => { log('INFO', '退出'); removePid(); process.exit(0); });
process.on('SIGTERM', () => { log('INFO', '退出'); removePid(); process.exit(0); });

main().catch(err => { log('FATAL', err.message); removePid(); process.exit(1); });
