/**
 * 消息服务
 * 处理任务消息的发送和接收
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MessageService');

export interface TaskMessage {
  id: string;
  task_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface MessageService {
  sendMessage(taskId: string, senderId: string, content: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  getMessages(taskId: string): Promise<TaskMessage[]>;
  getUnreadMessages(taskId: string, lastReadTime: string): Promise<TaskMessage[]>;
}

/**
 * 创建消息服务
 */
export function createMessageService(client: SupabaseClient): MessageService {
  return {
    /**
     * 发送消息到任务对话
     */
    async sendMessage(
      taskId: string,
      senderId: string,
      content: string
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
      logger.info(`发送消息 [${taskId.substring(0, 8)}]: ${content.substring(0, 50)}...`);

      const { data, error } = await client
        .from('task_messages')
        .insert({
          task_id: taskId,
          sender_id: senderId,
          content,
        })
        .select('id')
        .single();

      if (error) {
        logger.error(`发送消息失败: ${error.message}`);
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    },

    /**
     * 获取任务的所有消息
     */
    async getMessages(taskId: string): Promise<TaskMessage[]> {
      const { data, error } = await client
        .from('task_messages')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error(`获取消息失败: ${error.message}`);
        return [];
      }

      return (data || []) as TaskMessage[];
    },

    /**
     * 获取未读消息
     */
    async getUnreadMessages(taskId: string, lastReadTime: string): Promise<TaskMessage[]> {
      const { data, error } = await client
        .from('task_messages')
        .select('*')
        .eq('task_id', taskId)
        .gt('created_at', lastReadTime)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error(`获取未读消息失败: ${error.message}`);
        return [];
      }

      return (data || []) as TaskMessage[];
    },
  };
}
