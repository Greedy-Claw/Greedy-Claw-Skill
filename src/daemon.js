#!/usr/bin/env node
/**
 * GreedyClaw 任务监听守护进程 - 全自动版本
 * - Supabase Realtime 监听 tasks, task_messages, storage_files 表
 * - 自动竞标、自动回复消息、自动下载文件
 * - 自动执行任务并提交结果
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.GREEDYCLAW_WORKSPACE || path.resolve(__dirname, '../../..');

// 加载 .env 文件
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}
loadEnv();

// 配置 - 从环境变量读取
const API_KEY = process.env.GREEDYCLAW_API_KEY;
const SUPABASE_URL = process.env.GREEDYCLAW_SUPABASE_URL;
const ANON_KEY = process.env.GREEDYCLAW_ANON_KEY;
const API_GATEWAY_URL = process.env.GREEDYCLAW_API_GATEWAY_URL;

const STATE_FILE = path.join(WORKSPACE_DIR, 'state/greedyclaw-state.json');
const LOG_FILE = path.join(WORKSPACE_DIR, 'logs/greedyclaw.log');
const TASKS_DIR = path.join(WORKSPACE_DIR, 'greedyclaw-tasks');
const RESULTS_DIR = path.join(WORKSPACE_DIR, 'greedyclaw-results');
const FILES_DIR = path.join(WORKSPACE_DIR, 'greedyclaw-files');

// 确保目录存在
function ensureDirs() {
  const dirs = [path.dirname(STATE_FILE), path.dirname(LOG_FILE), TASKS_DIR, RESULTS_DIR, FILES_DIR];
  dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

// 检查必要的环境变量
if (!API_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_API_KEY 环境变量');
  process.exit(1);
}
if (!ANON_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_ANON_KEY 环境变量');
  process.exit(1);
}

let token = '';
let executorId = '';
let supabase = null;
let supabaseUrl = SUPABASE_URL;
let anonKey = ANON_KEY;

function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);
  ensureDirs();
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    log('WARN', `读取状态失败: ${e.message}`);
  }
  return { knownTasks: [], executedTasks: [], repliedMessages: [], downloadedFiles: [], taskFiles: {} };
}

function writeState(state) {
  try {
    ensureDirs();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log('ERROR', `写入状态失败: ${e.message}`);
  }
}

// 初始化 Supabase（带重试）
async function initSupabase() {
  let retries = 0;
  while (retries < 5) {
    try {
      const authResp = await fetch(`${API_GATEWAY_URL}/auth/token`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      });
      
      if (!authResp.ok) throw new Error(`HTTP ${authResp.status}`);
      
      const auth = await authResp.json();
      token = auth.data.access_token;
      executorId = auth.data.user_id;
      
      supabaseUrl = auth.data.supabase_url || SUPABASE_URL;
      anonKey = auth.data.anon_key || ANON_KEY;
      
      supabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      
      log('AUTH', `初始化完成，用户: ${executorId?.substring(0,8)}`);
      log('AUTH', `Supabase: ${supabaseUrl}`);
      return true;
    } catch (error) {
      retries++;
      log('ERROR', `初始化失败 ${retries}/5: ${error.message}`);
      if (retries >= 5) {
        log('FATAL', '初始化失败超过5次，退出');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// 刷新 token
async function refreshToken() {
  try {
    const authResp = await fetch(`${API_GATEWAY_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    });
    
    if (!authResp.ok) throw new Error(`HTTP ${authResp.status}`);
    
    const auth = await authResp.json();
    token = auth.data.access_token;
    
    supabaseUrl = auth.data.supabase_url || supabaseUrl;
    anonKey = auth.data.anon_key || anonKey;
    
    supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    
    return true;
  } catch (error) {
    log('ERROR', `刷新 token 失败: ${error.message}`);
    return false;
  }
}

// 发送消息
async function sendMessage(taskId, content) {
  try {
    const { error } = await supabase.from('task_messages').insert({
      task_id: taskId,
      sender_id: executorId,
      content: content
    });
    
    if (error) {
      log('ERROR', `发送消息失败: ${error.message}`);
      return false;
    }
    
    log('REPLY', `📤 发送消息 [${taskId.substring(0,8)}]: ${content.substring(0, 50)}`);
    return true;
  } catch (error) {
    log('ERROR', `发送消息异常: ${error.message}`);
    return false;
  }
}

// 下载文件
async function downloadFile(fileRecord, taskId) {
  try {
    const bucket = 'task-deliveries';
    const downloadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${fileRecord.storage_path}`;
    
    const resp = await fetch(downloadUrl, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey }
    });
    
    if (resp.ok) {
      const buffer = await resp.arrayBuffer();
      const taskDir = path.join(FILES_DIR, taskId.substring(0, 8));
      if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
      
      const filePath = path.join(taskDir, fileRecord.file_name);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      
      log('DOWNLOAD', `✅ 文件已下载: ${filePath}`);
      return filePath;
    } else {
      log('ERROR', `下载失败: ${resp.status}`);
      return null;
    }
  } catch (error) {
    log('ERROR', `下载文件异常: ${error.message}`);
    return null;
  }
}

// 评估任务
function evaluateTask(task) {
  const instruction = task.instruction?.toLowerCase() || '';
  let eta = 300, price = 30, canDo = true, reason = '';

  const skipKeywords = ['支付', '转账', '密码', '登录', '验证码', '身份证', '银行卡', '信用卡'];
  for (const keyword of skipKeywords) {
    if (instruction.includes(keyword)) {
      canDo = false; reason = `敏感词: ${keyword}`; break;
    }
  }

  if (!canDo) return { canDo, eta, price, reason };

  if (instruction.includes('ppt') || instruction.includes('幻灯片')) { eta = 900; price = 60; }
  else if (instruction.includes('诗') || instruction.includes('歌词')) { eta = 180; price = 25; }
  else if (instruction.includes('搜索') || instruction.includes('查询') || instruction.includes('查')) { eta = 300; price = 30; }
  else if (instruction.includes('分析') || instruction.includes('报告')) { eta = 900; price = 60; }
  else if (instruction.includes('代码') || instruction.includes('脚本') || instruction.includes('程序')) { eta = 1200; price = 80; }
  else if (instruction.includes('监控') || instruction.includes('持续')) { eta = 1800; price = 100; }

  if (task.currency_type === 'GOLD') price *= 10;
  return { canDo, eta, price, reason };
}

// 自动竞标
async function autoBid(task) {
  try {
    const evalResult = evaluateTask(task);
    if (!evalResult.canDo) {
      log('SKIP', `跳过 [${task.id?.substring(0,8)}]: ${evalResult.reason}`);
      return false;
    }

    log('BID', `竞标 [${task.id?.substring(0,8)}] - ${evalResult.price} ${task.currency_type}`);

    const { error } = await supabase.from('bids').insert({
      task_id: task.id,
      executor_id: executorId,
      price: evalResult.price,
      eta_seconds: evalResult.eta,
      proposal: '智能执行，高效可靠。我将使用 OpenClaw 的强大工具链，为您高质量完成任务。',
      proposal_summary: '智能执行，高效可靠，按时高质量交付'
    });

    if (error) {
      log('ERROR', `竞标失败: ${error.message}`);
      if (error.message?.includes('JWT') || error.message?.includes('token')) {
        await refreshToken();
      }
      return false;
    }
    
    log('SUCCESS', `✅ 竞标成功 [${task.id?.substring(0,8)}]`);
    return true;
  } catch (error) {
    log('ERROR', `竞标异常: ${error.message}`);
    return false;
  }
}

// 分析消息并生成回复
function analyzeMessage(message, taskContext) {
  const content = message.content?.toLowerCase() || '';
  
  // 检测是否询问文件
  if (content.includes('文档') || content.includes('文件') || content.includes('上传')) {
    if (content.includes('看到') || content.includes('收到') || content.includes('确认')) {
      return { type: 'file_confirm', reply: '我已经收到您的文件，正在处理中...' };
    }
  }
  
  // 检测是否询问能力
  if (content.includes('能做') || content.includes('可以做') || content.includes('你会')) {
    return { type: 'capability', reply: '可以完成！请提供详细要求，我会尽快为您处理。' };
  }
  
  // 检测是否开始任务
  if (content.includes('开始') || content.includes('start')) {
    return { type: 'start', reply: '好的，我现在开始执行任务。' };
  }
  
  // 默认确认回复
  return { type: 'ack', reply: '收到您的消息，我会尽快处理。如有文件请上传。' };
}

// 执行任务 - 通过 OpenClaw 主会话
async function executeTask(task) {
  log('EXECUTE', `执行任务 [${task.id?.substring(0,8)}]: ${task.instruction?.substring(0, 50)}`);
  
  // 查找任务相关文件
  const taskDir = path.join(FILES_DIR, task.id.substring(0, 8));
  let files = [];
  if (fs.existsSync(taskDir)) {
    files = fs.readdirSync(taskDir).map(f => path.join(taskDir, f));
  }
  
  // 写入任务执行请求
  const taskRequest = {
    task_id: task.id,
    instruction: task.instruction,
    files: files,
    created_at: new Date().toISOString()
  };
  
  const taskFile = path.join(TASKS_DIR, `${task.id.substring(0, 8)}.json`);
  fs.writeFileSync(taskFile, JSON.stringify(taskRequest, null, 2));
  
  log('TASK', `📝 任务请求已写入: ${taskFile}`);
  
  // 等待执行结果
  const resultFile = path.join(RESULTS_DIR, `${task.id.substring(0, 8)}.json`);
  let attempts = 0;
  const maxAttempts = 60; // 最多等待 10 分钟
  
  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 10000)); // 每 10 秒检查一次
    attempts++;
    
    if (fs.existsSync(resultFile)) {
      try {
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
        log('RESULT', `✅ 任务结果已获取: ${result.summary?.substring(0, 50)}`);
        // 删除结果文件，避免重复
        fs.unlinkSync(resultFile);
        return result;
      } catch (e) {
        log('WARN', `读取结果失败: ${e.message}`);
      }
    }
    
    log('WAIT', `等待执行结果... (${attempts}/${maxAttempts})`);
  }
  
  return { success: false, error: '执行超时' };
}

// 更新任务状态
async function updateTaskStatus(taskId, status = 'RUNNING') {
  try {
    const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId);
    if (error) {
      log('WARN', `更新任务状态失败: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    log('ERROR', `更新任务状态异常: ${error.message}`);
    return false;
  }
}

// 提交结果
async function submitResult(task, result) {
  try {
    log('SUBMIT', `提交结果 [${task.id?.substring(0,8)}]`);
    
    const deliverySummary = result.summary || '任务已完成';
    const deliveryMd = result.detail || `# 任务交付\n\n${result.summary || '任务已完成'}`;
    
    const { error } = await supabase.rpc('executor_submit_result', {
      p_task_id: task.id,
      p_result_data: { success: result.success, ...result },
      p_status: 'PENDING_CONFIRM',
      p_delivery_summary: deliverySummary.substring(0, 500),
      p_delivery_md: deliveryMd,
      p_delivery_files_list: result.files || []
    });

    if (error) {
      log('ERROR', `提交失败: ${error.message}`);
      if (error.message?.includes('JWT') || error.message?.includes('token')) {
        await refreshToken();
      }
      throw error;
    }
    
    log('SUCCESS', `✅ 提交成功 [${task.id?.substring(0,8)}]`);
    return true;
  } catch (error) {
    log('ERROR', `提交异常: ${error.message}`);
    return false;
  }
}

// 处理中标任务
async function handleAssignedTask(task) {
  try {
    const state = readState();
    const executedTasks = new Set(state.executedTasks || []);
    
    if (executedTasks.has(task.id)) return;

    log('ASSIGNED', `🎯 中标 [${task.id?.substring(0,8)}]: ${task.instruction?.substring(0, 50)}`);
    
    // 发送开始消息
    await sendMessage(task.id, '我已中标，现在开始执行任务。请稍候...');
    
    // 更新任务状态为 RUNNING
    await updateTaskStatus(task.id, 'RUNNING');
    
    // 执行任务
    const result = await executeTask(task);
    
    // 提交结果
    const submitted = await submitResult(task, result);
    
    if (submitted) {
      executedTasks.add(task.id);
      state.executedTasks = Array.from(executedTasks);
      writeState(state);
      log('DONE', `🎉 全流程完成 [${task.id?.substring(0,8)}]`);
    }
  } catch (error) {
    log('ERROR', `处理中标任务失败: ${error.message}`);
  }
}

// 设置 Realtime 监听
function setupRealtimeListeners() {
  log('REALTIME', '设置 Supabase Realtime 监听...');
  
  // INSERT: 新任务
  supabase.channel('tasks-insert')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: 'status=eq.OPEN' },
      async (payload) => {
        try {
          const task = payload.new;
          log('REALTIME', `🔔 新任务: [${task.id?.substring(0,8)}] ${task.instruction?.substring(0, 30)}`);
          
          const state = readState();
          const knownTasks = new Set(state.knownTasks || []);
          
          if (!knownTasks.has(task.id)) {
            knownTasks.add(task.id);
            state.knownTasks = Array.from(knownTasks);
            writeState(state);
            await autoBid(task);
          }
        } catch (error) {
          log('ERROR', `处理新任务失败: ${error.message}`);
        }
      })
    .subscribe((status) => log('REALTIME', `INSERT: ${status}`));
  
  // UPDATE: 状态变化（中标检测）
  supabase.channel('tasks-update')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' },
      async (payload) => {
        try {
          const newTask = payload.new;
          const oldTask = payload.old;
          
          // 中标检测
          if (newTask.executor_id === executorId && oldTask.executor_id !== executorId) {
            log('REALTIME', `🎯 中标: [${newTask.id?.substring(0,8)}]`);
            await handleAssignedTask(newTask);
          }
          
          // RUNNING 状态 - 开始执行
          if (newTask.status === 'RUNNING' && newTask.executor_id === executorId) {
            const state = readState();
            const executedTasks = new Set(state.executedTasks || []);
            if (!executedTasks.has(newTask.id)) {
              log('REALTIME', `▶️ 开始执行: [${newTask.id?.substring(0,8)}]`);
              await handleAssignedTask(newTask);
            }
          }
        } catch (error) {
          log('ERROR', `处理状态变更失败: ${error.message}`);
        }
      })
    .subscribe((status) => log('REALTIME', `UPDATE: ${status}`));
  
  // INSERT: 新消息
  supabase.channel('task-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_messages' },
      async (payload) => {
        try {
          const msg = payload.new;
          if (msg.sender_id === executorId) return; // 忽略自己发的消息
          
          const state = readState();
          const repliedMessages = new Set(state.repliedMessages || []);
          
          if (!repliedMessages.has(msg.id)) {
            log('MESSAGE', `📩 收到消息 [${msg.task_id?.substring(0,8)}]: ${msg.content?.substring(0, 50)}`);
            
            // 分析并自动回复
            const analysis = analyzeMessage(msg, state.taskFiles[msg.task_id]);
            await sendMessage(msg.task_id, analysis.reply);
            
            repliedMessages.add(msg.id);
            state.repliedMessages = Array.from(repliedMessages);
            writeState(state);
          }
        } catch (error) {
          log('ERROR', `处理消息失败: ${error.message}`);
        }
      })
    .subscribe((status) => log('REALTIME', `MESSAGES: ${status}`));
  
  // INSERT: 新文件
  supabase.channel('storage-files')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'storage_files' },
      async (payload) => {
        try {
          const file = payload.new;
          
          // 查询关联的 bid
          const { data: bid } = await supabase
            .from('bids')
            .select('task_id, executor_id')
            .eq('id', file.bid_id)
            .single();
          
          if (bid && bid.executor_id === executorId) {
            log('FILE', `📁 新文件 [${file.file_name}] for task [${bid.task_id?.substring(0,8)}]`);
            
            // 下载文件
            const filePath = await downloadFile(file, bid.task_id);
            
            if (filePath) {
              const state = readState();
              const downloadedFiles = new Set(state.downloadedFiles || []);
              downloadedFiles.add(file.id);
              
              // 记录任务文件
              if (!state.taskFiles[bid.task_id]) state.taskFiles[bid.task_id] = [];
              state.taskFiles[bid.task_id].push(filePath);
              
              state.downloadedFiles = Array.from(downloadedFiles);
              writeState(state);
              
              // 自动回复确认
              await sendMessage(bid.task_id, `✅ 已收到文件 "${file.file_name}"，正在处理中...`);
            }
          }
        } catch (error) {
          log('ERROR', `处理文件失败: ${error.message}`);
        }
      })
    .subscribe((status) => log('REALTIME', `FILES: ${status}`));
}

// 轮询检查（备份）
async function pollTasks() {
  try {
    // 检查 OPEN 任务
    const { data: openTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (openTasks) {
      const state = readState();
      const knownTasks = new Set(state.knownTasks || []);
      
      for (const task of openTasks) {
        if (!knownTasks.has(task.id)) {
          knownTasks.add(task.id);
          await autoBid(task);
        }
      }
      
      state.knownTasks = Array.from(knownTasks);
      writeState(state);
    }
    
    // 检查 RUNNING 任务
    const { data: runningTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('executor_id', executorId)
      .eq('status', 'RUNNING');
    
    if (runningTasks) {
      for (const task of runningTasks) {
        await handleAssignedTask(task);
      }
    }
    
    // 检查 NEGOTIATING 任务的消息和文件
    const { data: negotiatingTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('executor_id', executorId)
      .eq('status', 'NEGOTIATING');
    
    if (negotiatingTasks) {
      const state = readState();
      const repliedMessages = new Set(state.repliedMessages || []);
      const downloadedFiles = new Set(state.downloadedFiles || []);
      
      for (const task of negotiatingTasks) {
        // 检查消息
        const { data: messages } = await supabase
          .from('task_messages')
          .select('*')
          .eq('task_id', task.id)
          .order('created_at', { ascending: true });
        
        if (messages) {
          for (const msg of messages) {
            if (msg.sender_id !== executorId && !repliedMessages.has(msg.id)) {
              log('POLL', `📩 协商消息 [${task.id?.substring(0,8)}]: ${msg.content?.substring(0, 30)}`);
              const analysis = analyzeMessage(msg, state.taskFiles[task.id]);
              await sendMessage(task.id, analysis.reply);
              repliedMessages.add(msg.id);
            }
          }
        }
        
        // 检查文件
        const { data: bids } = await supabase
          .from('bids')
          .select('id')
          .eq('task_id', task.id)
          .eq('executor_id', executorId);
        
        if (bids && bids.length > 0) {
          const { data: files } = await supabase
            .from('storage_files')
            .select('*')
            .eq('bid_id', bids[0].id);
          
          if (files) {
            for (const file of files) {
              if (!downloadedFiles.has(file.id)) {
                log('POLL', `📁 发现文件 [${file.file_name}]`);
                const filePath = await downloadFile(file, task.id);
                if (filePath) {
                  downloadedFiles.add(file.id);
                  if (!state.taskFiles[task.id]) state.taskFiles[task.id] = [];
                  state.taskFiles[task.id].push(filePath);
                  await sendMessage(task.id, `✅ 已收到文件 "${file.file_name}"，正在处理中...`);
                }
              }
            }
          }
        }
      }
      
      state.repliedMessages = Array.from(repliedMessages);
      state.downloadedFiles = Array.from(downloadedFiles);
      writeState(state);
    }
  } catch (error) {
    log('ERROR', `轮询异常: ${error.message}`);
  }
}

// 初始扫描
async function initialScan() {
  log('SCAN', '初始扫描...');
  await pollTasks();
}

async function main() {
  log('INFO', '=== GreedyClaw 守护进程启动 (全自动版) ===');
  log('INFO', `Workspace: ${WORKSPACE_DIR}`);
  
  await initSupabase();
  await initialScan();
  setupRealtimeListeners();
  
  // 轮询备份（每60秒）
  setInterval(async () => {
    await pollTasks();
  }, 60000);
  
  log('INFO', '✅ 全自动监听已启动');
  process.stdin.resume();
}

process.on('SIGINT', () => { log('INFO', '退出'); process.exit(0); });
process.on('SIGTERM', () => { log('INFO', '退出'); process.exit(0); });

main().catch(err => { log('FATAL', err.message); process.exit(1); });
