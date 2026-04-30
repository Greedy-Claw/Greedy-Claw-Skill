/**
 * 任务服务
 * 封装任务相关的 RPC 调用和数据库操作
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../../BackendDoc/schema.js';

const logger = createLogger('TaskService');

type Task = Database['public']['Tables']['tasks']['Row'];
type Bid = Database['public']['Tables']['bids']['Row'];
type BidInsert = Database['public']['Tables']['bids']['Insert'];

export interface PostBidParams {
  taskId: string;
  executorId: string;
  price: number;
  etaSeconds: number;
  proposal: string;
  proposalSummary?: string;
}

export interface SubmitDeliveryParams {
  taskId: string;
  resultData: Record<string, unknown>;
  status: string;
  deliverySummary: string;
  deliveryMd: string;
  deliveryFilesList: string[];
}

export interface TaskContext {
  task: Task;
  messages: Array<{
    id: string;
    sender_id: string;
    content: string;
    created_at: string;
  }>;
  attachments: Array<{
    id: string;
    file_name: string;
    storage_path: string;
  }>;
}

export interface BidContext {
  task: Task;
  messages: Array<{
    id: string;
    sender_id: string;
    content: string;
    created_at: string;
  }>;
  attachments: Array<{
    id: string;
    file_name: string;
    storage_path: string;
  }>;
}

export interface TaskService {
  getOpenTasks(): Promise<Task[]>;
  getTaskById(taskId: string): Promise<Task | null>;
  getAssignedTasks(executorId: string): Promise<Task[]>;
  postBid(params: PostBidParams): Promise<{ success: boolean; bidId?: string; error?: string }>;
  getBidsForTask(taskId: string): Promise<Bid[]>;
  getMyBids(executorId: string): Promise<Bid[]>;
  submitDelivery(params: SubmitDeliveryParams): Promise<{ success: boolean; error?: string }>;
  updateTaskStatus(taskId: string, status: string): Promise<boolean>;
  getTaskContext(taskId: string, executorId: string): Promise<TaskContext | null>;
  getBidContext(bidId: string, executorId: string): Promise<BidContext | null>;
}

/**
 * 创建任务服务
 */
export function createTaskService(client: SupabaseClient): TaskService {
  return {
    /**
     * 获取所有开放任务
     */
    async getOpenTasks(): Promise<Task[]> {
      const { data, error } = await client
        .from('tasks')
        .select('*')
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        logger.error(`获取开放任务失败: ${error.message}`);
        return [];
      }

      return data || [];
    },

    /**
     * 根据 ID 获取任务
     */
    async getTaskById(taskId: string): Promise<Task | null> {
      const { data, error } = await client
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      if (error) {
        logger.error(`获取任务失败: ${error.message}`);
        return null;
      }

      return data;
    },

    /**
     * 获取已分配给执行者的任务
     */
    async getAssignedTasks(executorId: string): Promise<Task[]> {
      const { data, error } = await client
        .from('tasks')
        .select('*')
        .eq('executor_id', executorId)
        .in('status', ['ASSIGNED', 'RUNNING', 'NEGOTIATING'])
        .order('updated_at', { ascending: false });

      if (error) {
        logger.error(`获取已分配任务失败: ${error.message}`);
        return [];
      }

      return data || [];
    },

    /**
     * 提交竞标
     */
    async postBid(params: PostBidParams): Promise<{ success: boolean; bidId?: string; error?: string }> {
      logger.bid(`提交竞标 [${params.taskId.substring(0, 8)}] - ${params.price}`);

      const bidData: BidInsert = {
        task_id: params.taskId,
        executor_id: params.executorId,
        price: params.price,
        eta_seconds: params.etaSeconds,
        proposal: params.proposal,
        proposal_summary: params.proposalSummary || params.proposal.substring(0, 100),
      };

      const { data, error } = await client
        .from('bids')
        .insert(bidData)
        .select('id')
        .single();

      if (error) {
        logger.error(`竞标失败: ${error.message}`);
        return { success: false, error: error.message };
      }

      logger.bid(`竞标成功 [${params.taskId.substring(0, 8)}]`);
      return { success: true, bidId: data?.id };
    },

    /**
     * 获取任务的所有竞标
     */
    async getBidsForTask(taskId: string): Promise<Bid[]> {
      const { data, error } = await client
        .from('bids')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error(`获取竞标失败: ${error.message}`);
        return [];
      }

      return data || [];
    },

    /**
     * 获取执行者的所有竞标
     */
    async getMyBids(executorId: string): Promise<Bid[]> {
      const { data, error } = await client
        .from('bids')
        .select('*')
        .eq('executor_id', executorId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error(`获取我的竞标失败: ${error.message}`);
        return [];
      }

      return data || [];
    },

    /**
     * 提交交付结果
     */
    async submitDelivery(params: SubmitDeliveryParams): Promise<{ success: boolean; error?: string }> {
      logger.submit(`提交交付 [${params.taskId.substring(0, 8)}]`);

      const { error } = await client.rpc('executor_submit_result', {
        p_task_id: params.taskId,
        p_result_data: params.resultData,
        p_status: params.status,
        p_delivery_summary: params.deliverySummary.substring(0, 500),
        p_delivery_md: params.deliveryMd,
        p_delivery_files_list: params.deliveryFilesList,
      });

      if (error) {
        logger.error(`提交交付失败: ${error.message}`);
        return { success: false, error: error.message };
      }

      logger.submit(`交付成功 [${params.taskId.substring(0, 8)}]`);
      return { success: true };
    },

    /**
     * 更新任务状态
     */
    async updateTaskStatus(taskId: string, status: string): Promise<boolean> {
      const { error } = await client
        .from('tasks')
        .update({ status })
        .eq('id', taskId);

      if (error) {
        logger.error(`更新任务状态失败: ${error.message}`);
        return false;
      }

      return true;
    },

    /**
     * 获取任务上下文（任务详情 + 消息 + 附件）
     */
    async getTaskContext(taskId: string, executorId: string): Promise<TaskContext | null> {
      // 获取任务
      const { data: task, error: taskError } = await client
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .or(`owner_id.eq.${executorId},executor_id.eq.${executorId}`)
        .single();

      if (taskError || !task) {
        logger.error(`获取任务上下文失败: ${taskError?.message}`);
        return null;
      }

      // 获取 executor 的 bids（用于获取消息和附件）
      const { data: bids } = await client
        .from('bids')
        .select('id')
        .eq('task_id', taskId)
        .eq('executor_id', executorId);

      let messages: Array<{ id: string; sender_id: string; content: string; created_at: string }> = [];
      let attachments: Array<{ id: string; file_name: string; storage_path: string }> = [];

      if (bids && bids.length > 0) {
        const bidIds = bids.map(b => b.id);

        // 获取 bids_messages（通过 bid_id 关联）
        const { data: bidMessages } = await client
          .from('bids_messages')
          .select('id, sender_id, content, created_at')
          .in('bid_id', bidIds)
          .order('created_at', { ascending: true });
        
        messages = bidMessages || [];

        // 获取附件
        const { data: files } = await client
          .from('storage_files')
          .select('id, file_name, storage_path')
          .in('bid_id', bidIds);
        
        attachments = files || [];
      }

      return {
        task,
        messages,
        attachments,
      };
    },

    /**
     * 获取竞标上下文（通过 bidId 获取）
     * 用于磋商阶段获取对话历史
     */
    async getBidContext(bidId: string, executorId: string): Promise<BidContext | null> {
      // 获取 bid 信息
      const { data: bid, error: bidError } = await client
        .from('bids')
        .select('id, task_id, executor_id')
        .eq('id', bidId)
        .single();

      if (bidError || !bid) {
        logger.error(`获取竞标失败: ${bidError?.message}`);
        return null;
      }

      // 权限检查：只有 bid 的 executor 可访问
      if (bid.executor_id !== executorId) {
        logger.error(`无权访问竞标 ${bidId}`);
        return null;
      }

      // 获取任务
      const { data: task, error: taskError } = await client
        .from('tasks')
        .select('*')
        .eq('id', bid.task_id)
        .single();

      if (taskError || !task) {
        logger.error(`获取任务失败: ${taskError?.message}`);
        return null;
      }

      // 获取该 bid 的消息
      const { data: bidMessages } = await client
        .from('bids_messages')
        .select('id, sender_id, content, created_at')
        .eq('bid_id', bidId)
        .order('created_at', { ascending: true });

      const messages = bidMessages || [];

      // 获取该 bid 的附件
      const { data: files } = await client
        .from('storage_files')
        .select('id, file_name, storage_path')
        .eq('bid_id', bidId);

      const attachments = files || [];

      return {
        task,
        messages,
        attachments,
      };
    },
  };
}
