/**
 * 消息服务
 * 处理 bid 消息的发送和接收 (bids_messages 表)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MessageService');

export interface BidMessage {
  id: string;
  bid_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface MessageService {
  sendMessage(bidId: string, senderId: string, content: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  getMessages(bidId: string): Promise<BidMessage[]>;
  getUnreadMessages(bidId: string, lastReadTime: string): Promise<BidMessage[]>;
}

/**
 * 创建消息服务
 */
export function createMessageService(client: SupabaseClient): MessageService {
  return {
    /**
     * 发送消息到 bid 对话
     */
    async sendMessage(
      bidId: string,
      senderId: string,
      content: string
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
      logger.info(`发送消息 [bid: ${bidId.substring(0, 8)}]: ${content.substring(0, 50)}...`);

      const { data, error } = await client
        .from('bids_messages')
        .insert({
          bid_id: bidId,
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
     * 获取 bid 的所有消息
     */
    async getMessages(bidId: string): Promise<BidMessage[]> {
      const { data, error } = await client
        .from('bids_messages')
        .select('*')
        .eq('bid_id', bidId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error(`获取消息失败: ${error.message}`);
        return [];
      }

      return (data || []) as BidMessage[];
    },

    /**
     * 获取未读消息
     */
    async getUnreadMessages(bidId: string, lastReadTime: string): Promise<BidMessage[]> {
      const { data, error } = await client
        .from('bids_messages')
        .select('*')
        .eq('bid_id', bidId)
        .gt('created_at', lastReadTime)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error(`获取未读消息失败: ${error.message}`);
        return [];
      }

      return (data || []) as BidMessage[];
    },
  };
}
