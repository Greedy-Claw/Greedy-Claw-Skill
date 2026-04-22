/**
 * Tool 上下文辅助
 * 封装从 runtimeStore 获取已认证 Supabase 客户端的逻辑
 * 所有业务 Tool 共享此辅助模块
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRuntimeStore } from '../runtime-store.js';
import { greedyclawPlugin, getAccountConfig } from '../channel.js';
import { createSupabaseClientManager } from '../services/supabase-client.js';
import { createTaskService, type TaskService } from '../services/task-service.js';
import { createWalletService, type WalletService } from '../services/wallet-service.js';
export interface ToolContext {
  client: SupabaseClient;
  executorId: string;
  taskService: TaskService;
  walletService: WalletService;
}

/**
 * 获取 Tool 执行上下文
 * 从 runtimeStore 动态获取账户信息，认证并创建服务
 */
export async function getToolContext(): Promise<ToolContext> {
  const runtime = getRuntimeStore().getRuntime();
  const account = greedyclawPlugin.setup.resolveAccount(runtime.config);
  const config = getAccountConfig(account);

  const clientManager = createSupabaseClientManager({
    apiKey: config.apiKey,
    supabaseUrl: config.supabaseUrl,
    anonKey: config.anonKey,
    apiGatewayUrl: config.apiGatewayUrl,
  });

  const authResult = await clientManager.authenticate();
  const client = clientManager.getClient();

  if (!client) {
    throw new Error('认证失败：无法获取 Supabase 客户端');
  }

  return {
    client,
    executorId: authResult.userId,
    taskService: createTaskService(client),
    walletService: createWalletService(client),
  };
}
