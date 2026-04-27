/**
 * Greedy Claw Channel Plugin 入口
 * OpenClaw Plugin Entry Point
 *
 * 此文件是插件的入口，负责：
 * 1. 定义 Channel Plugin（通过 greedyclawPlugin）
 * 2. 在 registerFull 中注册 Agent 可调用的 Tools 和后台服务
 * 3. 通过 runtimeStore 在 outbound handlers 中访问运行时上下文
 */

import { defineChannelPluginEntry, type PluginApi } from "openclaw/plugin-sdk/channel-core";
import { greedyclawPlugin, getAccountConfig } from "./src/channel.js";
import { initRuntimeStore, getRuntimeStore } from "./src/runtime-store.js";
import { createSupabaseClientManager } from "./src/services/supabase-client.js";
import { createHeartbeatService } from "./src/services/heartbeat-service.js";
import { createInboundHandler } from "./src/inbound.js";
import { createGetBalanceTool } from "./src/tools/get-balance.js";
import { createPostBidTool } from "./src/tools/post-bid.js";
import { createSubmitDeliveryTool } from "./src/tools/submit-delivery.js";
import { createGetTaskContextTool } from "./src/tools/get-task-context.js";
import { createLogger } from "./src/utils/logger.js";

const logger = createLogger('Entry');

// 初始化 Runtime Store（必须在 defineChannelPluginEntry 之前）
initRuntimeStore();

// 服务单例，防止 registerFull 重复调用时创建多个实例
let inboundHandler: ReturnType<typeof createInboundHandler> | null = null;
let heartbeatService: ReturnType<typeof createHeartbeatService> | null = null;
let clientManager: ReturnType<typeof createSupabaseClientManager> | null = null;

export default defineChannelPluginEntry({
  id: "greedyclaw",
  name: "Greedy Claw",
  description: "Greedy Claw 任务平台智能竞标助手 - 自动监听、竞标、执行、提交",
  plugin: greedyclawPlugin,

  // 设置 runtime 引用
  setRuntime: (runtime) => {
    getRuntimeStore().setRuntime(runtime);
  },

  registerFull(api: PluginApi) {
    logger.info('Greedy Claw Plugin 全模式注册...');

    const runtime = getRuntimeStore().getRuntime();
    const account = greedyclawPlugin.setup.resolveAccount(runtime.config);
    const config = getAccountConfig(account);

    // 只创建一次 clientManager
    if (!clientManager) {
      clientManager = createSupabaseClientManager({
        apiKey: config.apiKey,
        supabaseUrl: config.supabaseUrl,
        anonKey: config.anonKey,
        apiGatewayUrl: config.apiGatewayUrl,
      });
    }

    // 注册 Tools（幂等，重复注册会被覆盖）
    api.registerTool(createGetBalanceTool());
    api.registerTool(createPostBidTool());
    api.registerTool(createSubmitDeliveryTool());
    api.registerTool(createGetTaskContextTool());

    // 注册空壳 service
    api.registerService({
      id: 'greedyclaw-background',
      start: async () => {},
      stop: () => {},
    });

    // 只启动一次服务
    if (!inboundHandler) {
      startServices(api).catch(err => {
        logger.error(`启动服务失败: ${err.message}`);
      });
    }

    logger.info('Greedy Claw Plugin 注册完成');
  },
});

async function startServices(api: PluginApi) {
  const authResult = await clientManager!.authenticate();
  const executorId = authResult.userId;
  const client = clientManager!.getClient();

  if (!client) {
    throw new Error('认证失败');
  }

  logger.info(`认证成功，executor: ${executorId?.substring(0, 8)}...`);

  // 启动 Inbound Handler（Observer Realtime）— 只创建一次
  inboundHandler = createInboundHandler(
    authResult.accessToken,
    authResult.supabaseUrl,
    authResult.anonKey,
    executorId,
    api
  );
  await inboundHandler.start();

  // 启动 Heartbeat — 只创建一次
  heartbeatService = createHeartbeatService(
    authResult.supabaseUrl,
    authResult.anonKey,
    () => clientManager!.getAccessToken(),
    () => clientManager!.getUserId(),
  );
  heartbeatService.start();

  logger.info('后台服务已启动');
}
