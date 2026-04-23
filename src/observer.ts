/**
 * Observer 服务
 * 监听 Supabase Realtime 事件，通过 api.runtime.subagent.run() 唤起 Agent
 */
import { createLogger } from './utils/logger.js';
import fs from 'fs';
import path from 'path';
const logger = createLogger('Observer');
// 持久化存储路径
const STATE_DIR = process.env.GREEDYCLAW_WORKSPACE || '/home/node/.openclaw/workspace';
const NOTIFIED_TASKS_FILE = path.join(STATE_DIR, 'state', 'greedyclaw-notified-tasks.json');
// 加载已通知的任务
function loadNotifiedTasks() {
    try {
        if (fs.existsSync(NOTIFIED_TASKS_FILE)) {
            const data = JSON.parse(fs.readFileSync(NOTIFIED_TASKS_FILE, 'utf-8'));
            return new Set(data.tasks || []);
        }
    } catch (e) { }
    return new Set();
}
// 保存已通知的任务
function saveNotifiedTasks(set) {
    try {
        const dir = path.dirname(NOTIFIED_TASKS_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(NOTIFIED_TASKS_FILE, JSON.stringify({ tasks: Array.from(set) }));
    } catch (e) { }
}
/**
 * 创建 Observer 服务
 */
export function createObserverService(client, config) {
    let channels = [];
    let pollIntervalId = null;
    // 追踪已通知的任务，使用持久化存储避免重连后重复通知
    const notifiedTasks = loadNotifiedTasks();
    const notifiedMessages = new Set();
    /**
     * 启动 Realtime 监听
     */
    async function start() {
        logger.realtime('启动 Supabase Realtime 监听...');
        // 监听新任务 INSERT
        const tasksChannel = client
            .channel('tasks-insert')
            .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'tasks',
            filter: 'status=eq.OPEN',
        }, (payload) => {
            const task = payload.new;
            if (notifiedTasks.has(task.id)) return; // 去重
            notifiedTasks.add(task.id);
            saveNotifiedTasks(notifiedTasks);
            logger.realtime(`新任务: [${task.id.substring(0, 8)}] ${task.instruction?.substring(0, 30)}`);
            config.onNewTask?.(task);
        })
            .subscribe((status) => {
            console.log("[greedyclaw-observer] tasks-insert channel status:", status);
            logger.realtime(`INSERT channel: ${status}`);
        });
        // 监听任务 UPDATE（中标检测）
        const updateChannel = client
            .channel('tasks-update')
            .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'tasks',
        }, (payload) => {
            const newTask = payload.new;
            const oldTask = payload.old;
            // 中标检测：executor_id 变更为当前用户
            if (newTask.executor_id === config.executorId && oldTask.executor_id !== config.executorId) {
                logger.realtime(`中标: [${newTask.id.substring(0, 8)}]`);
                config.onTaskAssigned?.(newTask);
            }
        })
            .subscribe((status) => {
            console.log("[greedyclaw-observer] tasks-update channel status:", status);
            logger.realtime(`UPDATE channel: ${status}`);
        });
        // 监听新消息
        const messagesChannel = client
            .channel('task-messages')
            .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'task_messages',
        }, (payload) => {
            const msg = payload.new;
            // 忽略自己发的消息 + 去重
            if (msg.sender_id !== config.executorId && !notifiedMessages.has(msg.id)) {
                notifiedMessages.add(msg.id);
                logger.realtime(`新消息 [${msg.task_id.substring(0, 8)}]: ${msg.content?.substring(0, 30)}`);
                config.onNewMessage?.(msg);
            }
        })
            .subscribe((status) => {
            console.log("[greedyclaw-observer] task-messages channel status:", status);
            logger.realtime(`MESSAGES channel: ${status}`);
        });
        channels = [tasksChannel, updateChannel, messagesChannel];
        // 启动轮询备份（每60秒）
        pollIntervalId = setInterval(async () => {
            await poll();
        }, 15000);
        logger.info('Observer 服务已启动');
    }
    /**
     * 停止监听
     */
    function stop() {
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
    async function poll() {
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
                    if (!notifiedTasks.has(task.id)) {
                        notifiedTasks.add(task.id);
                        saveNotifiedTasks(notifiedTasks);
                        config.onNewTask?.(task);
                    }
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
            // 轮询新消息（Negotiating 任务的未读消息）
            const { data: negotiatingTasks } = await client
                .from('tasks')
                .select('id')
                .eq('executor_id', config.executorId)
                .eq('status', 'NEGOTIATING');
            if (negotiatingTasks && negotiatingTasks.length > 0) {
                const taskIds = negotiatingTasks.map(t => t.id);
                const { data: newMessages } = await client
                    .from('task_messages')
                    .select('*')
                    .in('task_id', taskIds)
                    .neq('sender_id', config.executorId)
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (newMessages) {
                    for (const msg of newMessages) {
                        if (!notifiedMessages.has(msg.id)) {
                            notifiedMessages.add(msg.id);
                            console.log('[greedyclaw-observer-poll] 新消息:', msg.content?.substring(0, 30));
                            config.onNewMessage?.(msg);
                        }
                    }
                }
            }
        }
        catch (error) {
            logger.error(`轮询失败: ${error.message}`);
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
export function formatSessionKey(taskId) {
    return `agent:main:greedyclaw:task:${taskId}`;
}
/**
 * 构建新任务通知消息
 */
export function buildNewTaskMessage(task) {
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
export function buildAssignedTaskMessage(task) {
    return `恭喜！你已中标任务！

任务ID: ${task.id}
描述: ${task.instruction}

请开始执行任务。完成后使用 greedyclaw_submit_delivery 工具提交交付结果。`;
}
/**
 * 构建客户消息通知
 */
export function buildClientMessageMessage(message) {
    return `收到客户消息：

任务ID: ${message.task_id}
消息内容: ${message.content}

请根据客户消息做出回应。你可以直接回复，消息会通过平台发送给客户。`;
}
//# sourceMappingURL=observer.js.map