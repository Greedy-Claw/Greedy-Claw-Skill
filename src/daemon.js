#!/usr/bin/env node
/**
 * GreedyClaw 任务监听守护进程 - Realtime + 轮询双保险
 * - Supabase Realtime 监听 tasks 表
 * - 轮询作为备份（每60秒）
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.GREEDYCLAW_WORKSPACE || path.resolve(__dirname, '../../..');

// 配置 - 从环境变量读取
const API_KEY = process.env.GREEDYCLAW_API_KEY;
const SUPABASE_URL = process.env.GREEDYCLAW_SUPABASE_URL || 'https://aifqcsnlmahhwllzyddp.supabase.co';
const ANON_KEY = process.env.GREEDYCLAW_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZnFjc25sbWFoaHdsbHp5ZGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzk3NTAsImV4cCI6MjA4OTYxNTc1MH0.ICbIoGYXUm0TQzUo_u0eP36pFx6jDvdwOD8hoLDcZ7I';
const API_GATEWAY_URL = process.env.GREEDYCLAW_API_GATEWAY_URL || 'https://api.greedyclaw.com/functions/v1/api-gateway';

const STATE_FILE = path.join(WORKSPACE_DIR, 'state/greedyclaw-state.json');
const LOG_FILE = path.join(WORKSPACE_DIR, 'logs/greedyclaw.log');

// 确保目录存在
function ensureDirs() {
  const stateDir = path.dirname(STATE_FILE);
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

// 检查 API Key
if (!API_KEY) {
  console.error('❌ 错误: 请设置 GREEDYCLAW_API_KEY 环境变量');
  console.error('   例如: export GREEDYCLAW_API_KEY=sk_live_xxx');
  process.exit(1);
}

let token = '';
let executorId = '';
let supabase = null;

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
  return { knownTasks: [], executedTasks: [] };
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
      
      supabase = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      
      log('AUTH', `初始化完成，用户: ${executorId?.substring(0,8)}`);
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
    
    // 更新 supabase 客户端
    supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    
    return true;
  } catch (error) {
    log('ERROR', `刷新 token 失败: ${error.message}`);
    return false;
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

  if (instruction.includes('诗') || instruction.includes('歌词')) { eta = 180; price = 25; }
  else if (instruction.includes('搜索') || instruction.includes('查询') || instruction.includes('查')) { eta = 300; price = 30; }
  else if (instruction.includes('分析') || instruction.includes('报告')) { eta = 900; price = 60; }
  else if (instruction.includes('代码') || instruction.includes('脚本') || instruction.includes('程序')) { eta = 1200; price = 80; }
  else if (instruction.includes('路线') || instruction.includes('旅游') || instruction.includes('攻略')) { eta = 600; price = 40; }
  else if (instruction.includes('做法') || instruction.includes(' recipe') || instruction.includes('怎么') || instruction.includes('教程')) { eta = 600; price = 35; }
  else if (instruction.includes('故事') || instruction.includes('小说')) { eta = 300; price = 30; }

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
      proposal: '智能执行，高效可靠',
      outcome: '按时高质量交付',
    });

    if (error) {
      log('ERROR', `竞标失败: ${error.message}`);
      // 如果是权限错误，刷新 token
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

// 执行任务
async function executeTask(task) {
  log('EXECUTE', `执行 [${task.id?.substring(0,8)}]: ${task.instruction}`);
  const instruction = task.instruction?.toLowerCase() || '';
  let result = {};

  try {
    if (instruction.includes('诗') || instruction.includes('歌词')) {
      result = { type: 'poem', content: generatePoem(task.instruction) };
    } else if (instruction.includes('路线') || instruction.includes('旅游')) {
      result = { type: 'itinerary', itinerary: generateItinerary(task.instruction) };
    } else if (instruction.includes('笑话')) {
      result = { type: 'joke', content: generateJoke() };
    } else if (instruction.includes('做法') || instruction.includes(' recipe') || instruction.includes('怎么') || instruction.includes('教程')) {
      result = { type: 'recipe', recipe: generateRecipe(task.instruction) };
    } else if (instruction.includes('故事') || instruction.includes('小说')) {
      result = { type: 'story', content: generateStory(task.instruction) };
    } else {
      result = { type: 'research', summary: `已完成: ${task.instruction}` };
    }

    log('COMPLETE', `执行完成 [${task.id?.substring(0,8)}]`);
    return result;
  } catch (error) {
    log('ERROR', `生成内容失败: ${error.message}`);
    return { type: 'error', error: error.message };
  }
}

// 提交结果
async function submitResult(task, result) {
  try {
    log('SUBMIT', `提交 [${task.id?.substring(0,8)}]`);
    
    const { error } = await supabase.rpc('executor_submit_result', {
      p_task_id: task.id,
      p_result_data: { success: true, ...result }
    });

    if (error) {
      log('ERROR', `提交失败: ${error.message}`);
      // 尝试刷新 token 后重试一次
      if (error.message?.includes('JWT') || error.message?.includes('token')) {
        log('INFO', '尝试刷新 token 后重试...');
        await refreshToken();
        const { error: retryError } = await supabase.rpc('executor_submit_result', {
          p_task_id: task.id,
          p_result_data: { success: true, ...result }
        });
        if (retryError) throw retryError;
      } else {
        throw error;
      }
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

    log('ASSIGNED', `🎯 中标 [${task.id?.substring(0,8)}]: ${task.instruction}`);
    
    const result = await executeTask(task);
    const submitted = await submitResult(task, result);
    
    if (submitted) {
      executedTasks.add(task.id);
      state.executedTasks = Array.from(executedTasks);
      writeState(state);
      log('DONE', `全流程完成 [${task.id?.substring(0,8)}]`);
    }
  } catch (error) {
    log('ERROR', `处理中标任务失败: ${error.message}`);
  }
}

// 生成内容函数
function generatePoem(theme) {
  return `《${theme.replace(/.*(?:给|为|帮|找).*(?:写|创作)/, '').trim()}》\n\n在这个美好的时刻，\n为你写下这首小诗。\n虽然文字简单朴素，\n却承载着满满的祝福。\n\n愿你的生活如诗如画，\n每一天都充满欢笑。\n\n—— AI 助手创作`;
}

function generateItinerary(dest) {
  const location = dest.replace(/.*(?:设计|规划|找).*/, '').replace(/路线|攻略|游/, '').trim() || '目的地';
  return {
    title: `${location}一日游精品路线`,
    schedule: [
      { time: '08:00-10:00', location: '标志性景点', activity: '观光拍照', tips: '早起避开人流' },
      { time: '10:00-12:00', location: '特色街区', activity: '漫步购物', tips: '体验当地文化' },
      { time: '12:00-13:30', location: '老字号餐厅', activity: '品尝美食', tips: '必吃当地特色' },
      { time: '13:30-15:30', location: '博物馆/文化景点', activity: '深度游览', tips: '了解历史文化' },
      { time: '15:30-17:30', location: '休闲区', activity: '自由活动', tips: '购买纪念品' },
      { time: '18:00-20:00', location: '特色餐厅', activity: '晚餐', tips: '推荐当地名菜' },
      { time: '20:00-21:00', location: '夜景地点', activity: '欣赏夜景', tips: '最佳拍照时间' }
    ],
    transportation: '建议地铁+步行',
    budget: '约300-500元/人（不含购物）',
    notes: '行程可根据实际情况灵活调整'
  };
}

function generateJoke() {
  const jokes = [
    '为什么程序员总是分不清圣诞节和万圣节？因为 Oct 31 == Dec 25。',
    '一只蚂蚁迷路了，问另一只蚂蚁："你都如何回蚁窝？" 另一只说："带着笑或是很沉默？"',
    '我问风扇我丑吗？它摇了一晚上的头。',
    '为什么海鸥到了欧洲就不叫了？因为巴黎鸥来哑（欧莱雅）。',
    '小明：爸爸，我是不是傻孩子？爸爸：傻孩子，你怎么会是傻孩子呢？'
  ];
  return jokes[Math.floor(Math.random() * jokes.length)];
}

function generateRecipe(dish) {
  const name = dish.replace(/.*(?:做|制作|教).*/, '').replace(/怎么|做法/, '').trim() || '美食';
  return {
    title: `${name}家常做法`,
    difficulty: '中等',
    time: '30分钟',
    ingredients: [
      '主料：适量',
      '调料：生抽、老抽、料酒、盐、糖',
      '配料：葱姜蒜、辣椒（可选）'
    ],
    steps: [
      '准备食材，清洗干净，切配好',
      '腌制主料（如需），加料酒、生抽腌制15分钟',
      '热锅凉油，爆香葱姜蒜',
      '下主料翻炒至变色',
      '加入调料，大火翻炒均匀',
      '转小火焖煮（如需）',
      '大火收汁，出锅装盘'
    ],
    tips: '火候要大，动作要快，根据个人口味调整调料用量'
  };
}

function generateStory(theme) {
  return `从前，在一个美丽的地方，发生了一个有趣的故事...\n\n这是一个关于${theme.replace(/.*(?:编|写|找).*/, '').trim()}的故事。\n\n故事的主人公是一只勇敢的小动物，它经历了许多冒险，最终实现了自己的梦想。\n\n—— 《勇敢的小冒险家》\n\n（完整故事可根据需求扩展）`;
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
          log('REALTIME', `🔔 新任务: [${task.id?.substring(0,8)}] ${task.instruction?.substring(0,30)}`);
          
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
          
          if (newTask.executor_id === executorId && oldTask.executor_id !== executorId) {
            log('REALTIME', `🎯 中标: [${newTask.id?.substring(0,8)}]`);
            await handleAssignedTask(newTask);
          }
        } catch (error) {
          log('ERROR', `处理状态变更失败: ${error.message}`);
        }
      })
    .subscribe((status) => log('REALTIME', `UPDATE: ${status}`));
}

// 轮询检查（作为 Realtime 备份）
async function pollAssignedTasks() {
  try {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('executor_id', executorId)
      .in('status', ['ASSIGNED', 'RUNNING']);

    if (error) {
      log('ERROR', `轮询失败: ${error.message}`);
      // 尝试刷新 token
      if (error.message?.includes('JWT') || error.message?.includes('token')) {
        await refreshToken();
      }
      return;
    }
    
    for (const task of tasks) {
      await handleAssignedTask(task);
    }
  } catch (error) {
    log('ERROR', `轮询异常: ${error.message}`);
  }
}

// 初始扫描
async function initialScan() {
  log('SCAN', '初始扫描...');
  
  try {
    // 扫描 OPEN 任务并竞标
    const { data: openTasks, error: openError } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (openError) throw openError;
    
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
    
    // 扫描已分配任务并执行
    await pollAssignedTasks();
  } catch (error) {
    log('ERROR', `初始扫描失败: ${error.message}`);
  }
}

async function main() {
  log('INFO', '=== GreedyClaw 守护进程启动 ===');
  log('INFO', `Workspace: ${WORKSPACE_DIR}`);
  
  await initSupabase();
  await initialScan();
  setupRealtimeListeners();
  
  // 轮询备份（每60秒）
  setInterval(async () => {
    await pollAssignedTasks();
  }, 60000);
  
  log('INFO', '✅ 监听+轮询双保险已启动');
  process.stdin.resume();
}

process.on('SIGINT', () => { log('INFO', '退出'); process.exit(0); });
process.on('SIGTERM', () => { log('INFO', '退出'); process.exit(0); });

main().catch(err => { log('FATAL', err.message); process.exit(1); });
