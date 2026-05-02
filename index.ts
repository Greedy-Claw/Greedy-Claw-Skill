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
import { createInboundHandler, createWebhookHandler, WEBHOOK_PATH } from "./src/inbound.js";
import { createGetBalanceTool } from "./src/tools/get-balance.js";
import { createPostBidTool } from "./src/tools/post-bid.js";
import { createSubmitDeliveryTool } from "./src/tools/submit-delivery.js";
import { createGetTaskInfoTool } from "./src/tools/get-task-info.js";
import { createGetBidContextTool } from "./src/tools/get-bid-context.js";
import { createLogger } from "./src/utils/logger.js";

const logger = createLogger('Entry');

// 初始化 Runtime Store（必须在 defineChannelPluginEntry 之前）
initRuntimeStore();

// 服务单例，防止 registerFull 重复调用时创建多个实例
let inboundHandler: ReturnType<typeof createInboundHandler> | null = null;
let heartbeatService: ReturnType<typeof createHeartbeatService> | null = null;
let clientManager: ReturnType<typeof createSupabaseClientManager> | null = null;
let storedApi: PluginApi | null = null;

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
    api.registerTool(createGetTaskInfoTool());
    api.registerTool(createGetBidContextTool());

    // 注册 HTTP Webhook Route - 用于后台服务触发 Agent
    // 参考：https://github.com/openclaw/openclaw/blob/main/docs/plugins/sdk-channel-plugins.md
    // "The typical pattern is a webhook that verifies the request and dispatches it 
    //  through your channel's inbound handler."
    if (api.registerHttpRoute) {
      logger.info(`尝试注册 Webhook 路由: ${WEBHOOK_PATH}`);
      try {
        api.registerHttpRoute({
          path: WEBHOOK_PATH,
          auth: 'plugin', // 使用 plugin 认证
          handler: createWebhookHandler(api),
        });
        logger.info(`Webhook 路由注册成功: ${WEBHOOK_PATH}`);
      } catch (err) {
        logger.error(`Webhook 路由注册失败: ${(err as Error).message}`);
      }
    } else {
      logger.warn('registerHttpRoute 方法不可用，Webhook 功能将受限');
      logger.debug(`可用 API 方法: ${Object.keys(api).join(', ')}`);
    }

    // 存储 API 引用，供 startServices 使用
    storedApi = api;

    // 注册后台服务（Observer Realtime + Heartbeat）
    // OpenClaw 会在适当时机调用 start/stop，统一管理服务生命周期
    api.registerService({
      id: 'greedyclaw-background',
      start: async () => {
        // 防止重复启动
        if (inboundHandler) {
          logger.warn('服务已启动，跳过重复启动');
          return;
        }
        await startServices();
      },
      stop: () => {
        logger.info('停止后台服务...');
        inboundHandler?.stop();
        heartbeatService?.stop();
        inboundHandler = null;
        heartbeatService = null;
      },
    });

    logger.info('Greedy Claw Plugin 注册完成');
  },
});

async function startServices() {
let storedApi: PluginApi | null = null;

async function startServices() {
  const authResult = await clientManager!.authenticate();
  const executorId = authResult.userId;
  const client = clientManager!.getClient();

  if (!client) {
    throw new Error('认证失败');
  }

  logger.info(`认证成功，executor: ${executorId?.substring(0, 8)}...`);

  // 构建 webhook URL（内部调用）
  // 使用 Gateway 实际端口（从环境变量或默认 18789）
  const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT || '18789';
  const webhookUrl = `http://localhost:${gatewayPort}${WEBHOOK_PATH}`;

  // 创建 Runtime API（优先使用直接调用）
  const runtimeApi = storedApi ? {
    dispatchInbound: storedApi.runtime?.channel?.dispatchInbound,
    subagentRun: storedApi.runtime?.subagent?.run?.bind(storedApi.runtime.subagent),
  } : undefined;

  logger.info(`Runtime API 状态: dispatchInbound=${!!runtimeApi?.dispatchInbound}, subagentRun=${!!runtimeApi?.subagentRun}`);

  // 启动 Inbound Handler（Observer Realtime）— 只创建一次
  inboundHandler = createInboundHandler(
    authResult.accessToken,
    authResult.supabaseUrl,
    authResult.anonKey,
    executorId,
    webhookUrl,  // Webhook 作为备用
    runtimeApi   // 优先使用直接 runtime API
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
