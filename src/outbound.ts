/**
 * Outbound 消息处理
 * Agent → Greedy Claw 平台 API
 * 
 * 封装所有从 Agent 到 Greedy Claw 平台的出站操作
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createTaskService, type TaskService } from './services/task-service.js';
import { createWalletService, type WalletService } from './services/wallet-service.js';
import { createMessageService, type MessageService } from './services/message-service.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('Outbound');

/**
 * Outbound 处理器
 * 提供统一的出站操作接口
 */
export interface OutboundHandler {
  taskService: TaskService;
  walletService: WalletService;
  messageService: MessageService;
}

/**
 * 创建 Outbound 处理器
 */
export function createOutboundHandler(client: SupabaseClient): OutboundHandler {
  const taskService = createTaskService(client);
  const walletService = createWalletService(client);
  const messageService = createMessageService(client);

  logger.info('Outbound 处理器已创建');

  return {
    taskService,
    walletService,
    messageService,
  };
}
