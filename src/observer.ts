/**
 * Observer 服务
 * 监听 Supabase Realtime 事件，通过 api.runtime.subagent.run() 唤起 Agent
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from './utils/logger.js';
import type { Database } from '../schema.js';

const logger = createLogger('Observer');

type Task = Database['public']['Tables']['tasks']['Row'];
type TaskMessage = Database['public']['Tables']['task_messages']['Row'];

export interface ObserverConfig {
  executorId: string;
  onNewTask?: (task: Task) => void;
  onTaskAssigned?: (task: Task) => void;
  onNewMessage?: (message: TaskMessage) => void;
}

export interface ObserverService {
  start(): Promise<void>;
  stop(): void;
  poll(): Promise<void>;
}

/**
 * 创建 Observer 服务
 */
export function createObserverService(
  client: SupabaseClient,
  config: ObserverConfig
): ObserverService {
  let channels: Array<{ unsubscribe: () => void }> = [];
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * 启动 Realtime 监听
   */
  async function start(): Promise<void> {
    logger.realtime('启动 Supabase Realtime 监听...');

    // 监听新任务 INSERT
    const tasksChannel = client
      .channel('tasks-insert')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: 'status=eq.OPEN',
        },
        (payload) => {
          const task = payload.new as Task;
          logger.realtime(`新任务: [${task.id.substring(0, 8)}] ${task.instruction?.substring(0, 30)}`);
          config.onNewTask?.(task);
        }
      )
      .subscribe((status) => {
        logger.realtime(`INSERT channel: ${status}`);
      });

    // 监听任务 UPDATE（中标检测）
    const updateChannel = client
      .channel('tasks-update')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
        },
        (payload) => {
          const newTask = payload.new as Task;
          const oldTask = payload.old as Task;
          
          // 中标检测：executor_id 变更为当前用户
          if (newTask.executor_id === config.executorId && oldTask.executor_id !== config.executorId) {
            logger.realtime(`中标: [${newTask.id.substring(0, 8)}]`);
            config.onTaskAssigned?.(newTask);
          }
        }
      )
      .subscribe((status) => {
        logger.realtime(`UPDATE channel: ${status}`);
      });

    // 监听新消息
    const messagesChannel = client
      .channel('task-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_messages',
        },
        (payload) => {
          const msg = payload.new as TaskMessage;
          // 忽略自己发的消息
          if (msg.sender_id !== config.executorId) {
            logger.realtime(`新消息 [${msg.task_id.substring(0, 8)}]: ${msg.content?.substring(0, 30)}`);
            config.onNewMessage?.(msg);
          }
        }
      )
      .subscribe((status) => {
        logger.realtime(`MESSAGES channel: ${status}`);
      });

    channels = [tasksChannel, updateChannel, messagesChannel];

    // 启动轮询备份（每60秒）
    pollIntervalId = setInterval(async () => {
      await poll();
    }, 60000);

    logger.info('Observer 服务已启动');
  }

  /**
   * 停止监听
   */
  function stop(): void {
    for (const channel of channels) {
      channel.unsubscribe();
    }
    channels = [];
    
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    
    logger.info('Observer 服务已停止');
  }

  /**
   * 轮询备份（用于检测遗漏的任务）
   */
  async function poll(): Promise<void> {
    try {
      // 检查 OPEN 任务
      const { data: openTasks } = await client
        .from('tasks')
        .select('*')
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(20);

      if (openTasks) {
        for (const task of openTasks) {
          config.onNewTask?.(task);
        }
      }

      // 检查已分配但未执行的任务
      const { data: assignedTasks } = await client
        .from('tasks')
        .select('*')
        .eq('executor_id', config.executorId)
        .in('status', ['ASSIGNED', 'RUNNING']);

      if (assignedTasks) {
        for (const task of assignedTasks) {
          config.onTaskAssigned?.(task);
        }
      }
    } catch (error) {
      logger.error(`轮询失败: ${(error as Error).message}`);
    }
  }

  return {
    start,
    stop,
    poll,
  };
}

/**
 * Session Key 格式化
 */
export function formatSessionKey(taskId: string): string {
  return `agent:main:greedyclaw:task:${taskId}`;
}

/**
 * 构建新任务通知消息
 */
export function buildNewTaskMessage(task: Task): string {
  return `发现新任务！

任务ID: ${task.id}
描述: ${task.instruction}
货币类型: ${task.currency_type}
锁定金额: ${task.locked_amount || '未指定'}
任务类型: ${task.task_type}

请分析任务并决定是否竞标。如果决定竞标，请使用 greedyclaw_post_bid 工具提交竞标。`;
}

/**
 * 构建中标通知消息
 */
export function buildAssignedTaskMessage(task: Task): string {
  return `恭喜！你已中标任务！

任务ID: ${task.id}
描述: ${task.instruction}

请开始执行任务。完成后使用 greedyclaw_submit_delivery 工具提交交付结果。`;
}

/**
 * 构建客户消息通知
 */
export function buildClientMessageMessage(message: TaskMessage): string {
  return `收到客户消息：

任务ID: ${message.task_id}
消息内容: ${message.content}

请根据客户消息做出回应。可以使用 greedyclaw_ask_client 工具回复客户。`;
}
