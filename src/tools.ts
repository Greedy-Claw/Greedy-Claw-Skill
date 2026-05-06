/**
 * GreedyClaw 工具定义 — 直接 Supabase 调用，无 HTTP 中转
 */

import { getSupabase, getExecutorId, getAuthManager } from './state.js';
import { randomUUID } from 'crypto';

// ========================================
// 类型
// ========================================
interface ToolResult {
  content: { type: 'text'; text: string }[];
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}
function err(msg: string): ToolResult {
  return { content: [{ type: 'text', text: msg }] };
}

function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    md: 'text/markdown',
    zip: 'application/zip',
    json: 'application/json',
    csv: 'text/csv',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ========================================
// 工具定义
// ========================================
export function createTools() {
  return [
    {
      name: 'greedyclaw_get_task_info',
      label: 'GreedyClaw Get Task Info',
      description: '获取 GreedyClaw 任务信息。收到 new_task 事件后调用此工具评估任务。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 ID' },
        },
        required: ['taskId'],
      },
      execute: async (_toolCallId: string, args: { taskId: string }) => {
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from('tasks')
            .select('id, instruction, status, owner_id, executor_id, currency_type, locked_amount, task_type, created_at')
            .eq('id', args.taskId)
            .single();
          if (error) throw new Error(error.message);
          if (!data) return err(`未找到任务 ${args.taskId}`);
          return ok(JSON.stringify(data, null, 2));
        } catch (e: any) {
          return err(`获取任务信息失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_post_bid',
      label: 'GreedyClaw Post Bid',
      description: '提交任务竞标。评估任务后决定竞标时调用。需提供价格、预计完成时间和提案。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 ID' },
          price: { type: 'number', description: '竞标价格' },
          etaSeconds: { type: 'number', description: '预计完成时间（秒）' },
          proposal: { type: 'string', description: '竞标提案（Markdown 格式）' },
        },
        required: ['taskId', 'price', 'etaSeconds'],
      },
      execute: async (_toolCallId: string, args: { taskId: string; price: number; etaSeconds: number; proposal?: string }) => {
        try {
          const supabase = getSupabase();
          const executorId = getExecutorId();
          const payload: Record<string, unknown> = {
            task_id: args.taskId,
            price: args.price,
            eta_seconds: args.etaSeconds,
            proposal: args.proposal || null,
          };
          if (executorId) payload.executor_id = executorId;
          const { data, error } = await supabase.from('bids').insert(payload).select().single();
          if (error) throw new Error(error.message);
          return ok(JSON.stringify(data, null, 2));
        } catch (e: any) {
          return err(`竞标失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_send_message',
      label: 'GreedyClaw Send Message',
      description: '发送消息给雇主，用于洽谈任务细节。竞标后可主动联系雇主。',
      parameters: {
        type: 'object',
        properties: {
          bidId: { type: 'string', description: '竞标 ID' },
          content: { type: 'string', description: '消息内容' },
        },
        required: ['bidId', 'content'],
      },
      execute: async (_toolCallId: string, args: { bidId: string; content: string }) => {
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase.rpc('send_bid_message', {
            p_bid_id: args.bidId,
            p_content: args.content,
          });
          if (error) throw new Error(error.message);
          return ok(JSON.stringify(data, null, 2));
        } catch (e: any) {
          return err(`发送消息失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_submit_delivery',
      label: 'GreedyClaw Submit Delivery',
      description: '提交任务交付结果。中标并完成任务后调用。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 ID' },
          result: { type: 'string', description: '任务结果（JSON 字符串或纯文本）' },
          deliverySummary: { type: 'string', description: '交付摘要（纯文本，最多 500 字符）' },
          deliveryMd: { type: 'string', description: '交付详情（Markdown 格式）' },
        },
        required: ['taskId', 'result'],
      },
      execute: async (_toolCallId: string, args: { taskId: string; result: string; deliverySummary?: string; deliveryMd?: string }) => {
        try {
          const supabase = getSupabase();
          let resultData: any;
          try { resultData = JSON.parse(args.result); } catch { resultData = args.result; }
          const { data, error } = await supabase.rpc('executor_submit_result', {
            p_task_id: args.taskId,
            p_result_data: resultData,
            p_status: 'PENDING_CONFIRM',
            p_delivery_summary: args.deliverySummary || '',
            p_delivery_md: args.deliveryMd || '',
            p_delivery_files_list: [],
          });
          if (error) throw new Error(error.message);
          return ok(JSON.stringify(data, null, 2));
        } catch (e: any) {
          return err(`提交交付失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_get_balance',
      label: 'GreedyClaw Get Balance',
      description: '查询 GreedyClaw 钱包余额。',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          const executorId = getExecutorId();
          const authManager = getAuthManager();
          const supabase = getSupabase();

          // 查询 wallets 表获取实际余额
          let walletInfo: Record<string, unknown> | null = null;
          if (executorId) {
            const { data: wallet, error: walletError } = await supabase
              .from('wallets')
              .select('gold_balance, silver_balance, updated_at')
              .eq('user_id', executorId)
              .single();
            if (!walletError && wallet) {
              walletInfo = wallet;
            }
          }

          return ok(JSON.stringify({
            executorId: executorId || 'anonymous',
            authMode: authManager ? 'jwt' : 'direct',
            sessionExpiring: authManager?.isSessionExpiring() ?? true,
            wallet: walletInfo ?? { gold_balance: null, silver_balance: null },
          }, null, 2));
        } catch (e: any) {
          return err(`查询余额失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_upload_file',
      label: 'GreedyClaw Upload File',
      description: '上传文件到任务交付目录。',
      parameters: {
        type: 'object',
        properties: {
          bidId: { type: 'string', description: '竞标 ID' },
          fileName: { type: 'string', description: '原始文件名' },
          fileBase64: { type: 'string', description: '文件的 Base64 编码内容' },
          description: { type: 'string', description: '文件描述（可选）' },
        },
        required: ['bidId', 'fileName', 'fileBase64'],
      },
      execute: async (_toolCallId: string, args: { bidId: string; fileName: string; fileBase64: string; description?: string }) => {
        try {
          const supabase = getSupabase();
          const executorId = getExecutorId();

          // 查询 bid
          const { data: bid, error: bidError } = await supabase
            .from('bids')
            .select('id, task_id, executor_id, status')
            .eq('id', args.bidId)
            .single();
          if (bidError || !bid) return err('Bid not found');

          // 生成 storage path
          const ext = args.fileName.includes('.') ? '.' + args.fileName.split('.').pop() : '';
          const storageFileName = randomUUID() + ext;
          const storagePath = `${bid.task_id}/${args.bidId}/executor/${storageFileName}`;

          // 上传 — 触发器 trg_storage_object_insert 会自动在 storage_files 中创建记录
          const fileBuffer = Buffer.from(args.fileBase64, 'base64');
          const { error: uploadError } = await supabase.storage
            .from('task-deliveries')
            .upload(storagePath, fileBuffer, {
              contentType: getContentType(args.fileName),
              upsert: false,
              metadata: {
                original_name: args.fileName,
                ...(args.description ? { description: args.description } : {}),
              },
            });
          if (uploadError) return err(`Storage upload failed: ${uploadError.message}`);

          // 查询触发器自动创建的 storage_files 记录
          const { data: fileRecord, error: queryError } = await supabase
            .from('storage_files')
            .select('id, storage_path, created_at')
            .eq('storage_path', storagePath)
            .single();
          if (queryError || !fileRecord) {
            return err(`File uploaded but record lookup failed: ${queryError?.message || 'not found'}`);
          }

          return ok(JSON.stringify({
            id: fileRecord.id,
            storagePath: fileRecord.storage_path,
            fileName: args.fileName,
            createdAt: fileRecord.created_at,
          }, null, 2));
        } catch (e: any) {
          return err(`上传文件失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_list_files',
      label: 'GreedyClaw List Files',
      description: '列出任务交付文件。',
      parameters: {
        type: 'object',
        properties: {
          bidId: { type: 'string', description: '竞标 ID（可选）' },
        },
      },
      execute: async (_toolCallId: string, args: { bidId?: string }) => {
        try {
          const supabase = getSupabase();
          let query = supabase
            .from('storage_files')
            .select('id, bid_id, storage_path, user_metadata, file_name, file_size, created_at, created_by')
            .order('created_at', { ascending: false });
          if (args.bidId) query = query.eq('bid_id', args.bidId);
          const { data, error } = await query;
          if (error) throw new Error(error.message);
          const files = (data || []).map(f => ({
            id: f.id,
            bidId: f.bid_id,
            storagePath: f.storage_path,
            fileName: (f.user_metadata as any)?.original_name || f.file_name || f.storage_path.split('/').pop(),
            fileSize: f.file_size,
            createdAt: f.created_at,
            createdBy: f.created_by,
          }));
          return ok(JSON.stringify(files, null, 2));
        } catch (e: any) {
          return err(`列出文件失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_download_file',
      label: 'GreedyClaw Download File',
      description: '下载任务交付文件。返回文件的 Base64 编码内容和原始文件名。',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件 ID' },
        },
        required: ['fileId'],
      },
      execute: async (_toolCallId: string, args: { fileId: string }) => {
        try {
          const supabase = getSupabase();

          // 查询记录
          const { data: fileRecord, error: dbError } = await supabase
            .from('storage_files')
            .select('id, storage_path, user_metadata, file_name')
            .eq('id', args.fileId)
            .single();
          if (dbError || !fileRecord) return err('File record not found');

          // 下载
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('task-deliveries')
            .download(fileRecord.storage_path);
          if (downloadError || !fileData) return err('Failed to download file from storage');

          const originalName = (fileRecord.user_metadata as any)?.original_name
            || fileRecord.file_name
            || fileRecord.storage_path.split('/').pop()
            || 'download';

          const buffer = Buffer.from(await fileData.arrayBuffer());
          const base64 = buffer.toString('base64');

          return ok(JSON.stringify({
            fileName: originalName,
            contentType: getContentType(originalName),
            sizeBytes: buffer.length,
            fileBase64: base64,
          }, null, 2));
        } catch (e: any) {
          return err(`下载文件失败: ${e.message}`);
        }
      },
    },

    {
      name: 'greedyclaw_delete_file',
      label: 'GreedyClaw Delete File',
      description: '删除任务交付文件。',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件 ID' },
        },
        required: ['fileId'],
      },
      execute: async (_toolCallId: string, args: { fileId: string }) => {
        try {
          const supabase = getSupabase();

          const { data: fileRecord, error: dbError } = await supabase
            .from('storage_files')
            .select('id, storage_path')
            .eq('id', args.fileId)
            .single();
          if (dbError || !fileRecord) return err('File record not found');

          const { error: storageError } = await supabase.storage
            .from('task-deliveries')
            .remove([fileRecord.storage_path]);

          if (!storageError) {
            // Storage 删除成功，触发器会自动清理 storage_files 记录
          } else {
            // Storage 删除失败，尝试直接删除记录
            const { error: deleteError } = await supabase
              .from('storage_files')
              .delete()
              .eq('id', args.fileId);
            if (deleteError) return err('Failed to delete file record');
          }

          return ok(JSON.stringify({ id: args.fileId, deleted: true }));
        } catch (e: any) {
          return err(`删除文件失败: ${e.message}`);
        }
      },
    },
  ];
}
