/**
 * Greedy Claw Channel Plugin 入口
 * OpenClaw Plugin Entry Point
 * 
 * 此文件是插件的入口，负责：
 * 1. 定义 Channel Plugin（通过 greedyclawPlugin）
 * 2. 注册 Agent 可调用的 Tools
 * 3. 注册后台服务（Observer、Heartbeat）
 */

import { defineChannelPluginEntry, type PluginApi } from "openclaw/plugin-sdk/channel-core";
import { greedyclawPlugin, type ResolvedAccount, getAccountConfig } from "./src/channel.js";
import { createSupabaseClientManager } from "./src/services/supabase-client.js";
import { createHeartbeatService } from "./src/services/heartbeat-service.js";
import { createOutboundHandler } from "./src/outbound.js";
import { createInboundHandler } from "./src/inbound.js";
import { createGetBalanceTool } from "./src/tools/get-balance.js";
import { createPostBidTool } from "./src/tools/post-bid.js";
import { createAskClientTool } from "./src/tools/ask-client.js";
import { createSubmitDeliveryTool } from "./src/tools/submit-delivery.js";
import { createGetTaskContextTool } from "./src/tools/get-task-context.js";
import { createLogger } from "./src/utils/logger.js";

const logger = createLogger('Entry');

/**
 * 初始化插件：认证 → 注册 Tools → 启动服务
 * 
 * 此函数在运行时被调用，完成以下步骤：
 * 1. 使用 API Key 认证获取 Supabase access token
 * 2. 创建 Supabase 客户端
 * 3. 注册 Agent 可调用的 Tools
 * 4. 启动 Observer 服务（监听新任务、中标、消息）
 * 5. 启动 Heartbeat 服务（心跳挖矿）
 */
async function initializePlugin(
  api: PluginApi,
  account: ResolvedAccount,
): Promise<void> {
  const config = getAccountConfig(account);
  const clientManager = createSupabaseClientManager({
    apiKey: config.apiKey,
    supabaseUrl: config.supabaseUrl,
    anonKey: config.anonKey,
    apiGatewayUrl: config.apiGatewayUrl,
  });

  // 认证
  const authResult = await clientManager.authenticate();
  const executorId = authResult.userId;

  const client = clientManager.getClient();
  if (!client) {
    throw new Error('认证失败：无法获取 Supabase 客户端');
  }

  // 创建 Outbound 处理器
  const outbound = createOutboundHandler(client);

  // 注册 Agent Tools
  api.registerTool(createGetBalanceTool(outbound.walletService));
  api.registerTool(createPostBidTool(outbound.taskService, executorId));
  api.registerTool(createAskClientTool(outbound.messageService, executorId));
  api.registerTool(createSubmitDeliveryTool(outbound.taskService));
  api.registerTool(createGetTaskContextTool(outbound.taskService, executorId));

  logger.info('Agent Tools 已注册');

  // 启动 Inbound 处理器（Observer + subagent 分发）
  const inboundHandler = createInboundHandler(clientManager, api);
  await inboundHandler.start();

  // 启动 Heartbeat 服务
  const heartbeatService = createHeartbeatService(
    config.supabaseUrl,
    config.anonKey,
    () => clientManager.getAccessToken(),
    () => clientManager.getUserId(),
  );
  heartbeatService.start();

  logger.info('Greedy Claw Plugin 初始化完成');
}

export default defineChannelPluginEntry({
  id: "greedyclaw",
  name: "Greedy Claw",
  description: "Greedy Claw 任务平台智能竞标助手 - 自动监听、竞标、执行、提交",
  plugin: greedyclawPlugin,

  registerFull(_api: PluginApi) {
    logger.info('Greedy Claw Plugin 注册中...');

    // TODO: 当 OpenClaw 提供账户解析钩子时，在此处调用 initializePlugin
    // 当前方案：initializePlugin 导出供外部调用
    // 预期流程：OpenClaw 解析配置 → 调用 resolveAccount → 传入 account → 触发初始化
    //
    // 示例（待 OpenClaw SDK 完善）:
    // _api.onAccountReady((account: ResolvedAccount) => {
    //   initializePlugin(_api, account);
    // });

    logger.info('Greedy Claw Plugin 注册完成（等待运行时账户初始化）');
  },
});

// 导出初始化函数供外部使用
export { initializePlugin };
