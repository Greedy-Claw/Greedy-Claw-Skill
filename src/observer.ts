/**
 * Observer 服务
 * 监听 Supabase Realtime 事件
 *
 * 注意：必须显式传入 ws transport，因为 Gateway 进程中原生 WebSocket 不可用
 */
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { createLogger } from './utils/logger.js';
import fs from 'fs';
import path from 'path';

const logger = createLogger('Observer');
const STATE_DIR = process.env.GREEDYCLAW_WORKSPACE || '/home/node/.openclaw/workspace';
const NOTIFIED_TASKS_FILE = path.join(STATE_DIR, 'state', 'greedyclaw-notified-tasks.json');

function loadNotifiedTasks(): Set<string> {
  try {
    if (fs.existsSync(NOTIFIED_TASKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFIED_TASKS_FILE, 'utf-8'));
      return new Set(data.tasks || []);
    }
  } catch (e) {}
  return new Set();
}

function saveNotifiedTasks(set: Set<string>): void {
  try {
    const dir = path.dirname(NOTIFIED_TASKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(NOTIFIED_TASKS_FILE, JSON.stringify({ tasks: Array.from(set) }));
  } catch (e) {}
}

export interface ObserverConfig {
  supabaseUrl: string;
  anonKey: string;
  executorId: string;
  onNewTask?: (task: any) => Promise<void>;
  onTaskAssigned?: (task: any) => Promise<void>;
  onNewMessage?: (msg: any) => Promise<void>;
}

/**
 * 创建 Observer 服务
 * 使用专用 Realtime client + ws transport（Gateway 进程原生 WebSocket 不可用）
 */
export function createObserverService(accessToken: string, config: ObserverConfig) {
  let channels: any[] = [];
  const notifiedTasks = loadNotifiedTasks();
  const notifiedMessages = new Set<string>();

  // 创建专用 Realtime client（显式传入 ws transport）
  const rtClient = createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    realtime: {
      params: { eventsPerSecond: 10 },
      transport: WebSocket as any,
    },
  });
  rtClient.realtime.setAuth(accessToken);

  async function start(): Promise<void> {
    logger.info('启动 Supabase Realtime 监听...');

    // 监听新任务 INSERT
    const tasksChannel = rtClient
      .channel('tasks-insert')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'tasks',
      }, (payload: any) => {
        const task = payload.new;
        if (task.status !== 'OPEN') return;
        if (notifiedTasks.has(task.id)) return;

        notifiedTasks.add(task.id);
        saveNotifiedTasks(notifiedTasks);
        logger.info(`新任务: [${task.id.substring(0, 8)}] ${task.instruction?.substring(0, 30)}`);
        config.onNewTask?.(task);
      })
      .subscribe((status: string, err?: Error) => {
        logger.info(`tasks-insert: ${status}${err ? ' err: ' + err.message : ''}`);
      });

    // 监听任务 UPDATE（中标检测）
    const updateChannel = rtClient
      .channel('tasks-update')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tasks',
      }, (payload: any) => {
        const newTask = payload.new;
        const oldTask = payload.old;
        if (newTask.executor_id === config.executorId && oldTask.executor_id !== config.executorId) {
          logger.info(`中标: [${newTask.id.substring(0, 8)}]`);
          config.onTaskAssigned?.(newTask);
        }
      })
      .subscribe((status: string, err?: Error) => {
        logger.info(`tasks-update: ${status}${err ? ' err: ' + err.message : ''}`);
      });

    // 监听新消息 (bids_messages)
    const messagesChannel = rtClient
      .channel('bids-messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bids_messages',
      }, (payload: any) => {
        const msg = payload.new;
        if (msg.sender_id !== config.executorId && !notifiedMessages.has(msg.id)) {
          notifiedMessages.add(msg.id);
          logger.info(`新消息 [bid: ${msg.bid_id.substring(0, 8)}]: ${msg.content?.substring(0, 30)}`);
          config.onNewMessage?.(msg);
        }
      })
      .subscribe((status: string, err?: Error) => {
        logger.info(`bids-messages: ${status}${err ? ' err: ' + err.message : ''}`);
      });

    channels = [tasksChannel, updateChannel, messagesChannel];
    logger.info('Observer 已启动');
  }

  function stop(): void {
    for (const channel of channels) {
      channel.unsubscribe();
    }
    channels = [];
    logger.info('Observer 已停止');
  }

  return { start, stop };
}

export function formatSessionKey(taskId: string): string {
  return `agent:main:greedyclaw:task:${taskId}`;
}

export function buildNewTaskMessage(task: any): string {
  return `发现新任务！

任务ID: ${task.id}
描述: ${task.instruction}
货币类型: ${task.currency_type}
锁定金额: ${task.locked_amount || '未指定'}

请分析任务并决定是否竞标。`;
}

export function buildAssignedTaskMessage(task: any): string {
  return `恭喜！你已中标任务！

任务ID: ${task.id}
描述: ${task.instruction}

请开始执行任务。完成后使用 greedyclaw_submit_delivery 工具提交交付结果。`;
}

export function buildClientMessageMessage(message: any): string {
  return `收到客户消息：

Bid ID: ${message.bid_id}
消息内容: ${message.content}

请根据客户消息做出回应。`;
}
