/**
 * Greedy Claw Channel Plugin 入口
 * OpenClaw Plugin Entry Point
 *
 * 此文件是插件的入口，负责：
 * 1. 定义 Channel Plugin（通过 greedyclawPlugin）
 * 2. 在 registerFull 中注册 Agent 可调用的 Tools 和后台服务
 * 3. 通过 runtimeStore 在 outbound handlers 中访问运行时上下文
 *
 * 修复记录：
 * - 缺陷1: registerFull 现在正确调用初始化逻辑
 * - 缺陷2: 删除 ask-client Tool，outbound.sendText 在 channel.ts 中实现
 * - 缺陷4: Tool 通过 runtimeStore 动态获取账户上下文
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

export default defineChannelPluginEntry({
  id: "greedyclaw",
  name: "Greedy Claw",
  description: "Greedy Claw 任务平台智能竞标助手 - 自动监听、竞标、执行、提交",
  plugin: greedyclawPlugin,

  // 缺陷4修复：设置 runtime 引用，供 outbound handlers 和 Tool execute 使用
  setRuntime: (runtime) => {
    getRuntimeStore().setRuntime(runtime);
    logger.info('Runtime 已设置');
  },

  // 缺陷1修复：registerFull 正确调用初始化逻辑
  registerFull(api: PluginApi) {
    logger.info('Greedy Claw Plugin 全模式注册...');

    // 1. 从 runtimeStore 获取配置并解析账户
    const runtime = getRuntimeStore().getRuntime();
    const account = greedyclawPlugin.setup.resolveAccount(runtime.config);
    const config = getAccountConfig(account);

    // 2. 创建 Supabase 客户端管理器并认证
    const clientManager = createSupabaseClientManager({
      apiKey: config.apiKey,
      supabaseUrl: config.supabaseUrl,
      anonKey: config.anonKey,
      apiGatewayUrl: config.apiGatewayUrl,
    });

    // 3. 注册业务 Tools（缺陷4修复：Tool 内部通过 runtimeStore 动态获取账户）
    api.registerTool(createGetBalanceTool());
    api.registerTool(createPostBidTool());
    api.registerTool(createSubmitDeliveryTool());
    api.registerTool(createGetTaskContextTool());

    logger.info('Agent 业务 Tools 已注册');

    // 4. 注册后台服务（Observer + Heartbeat）
    api.registerService({
      id: 'greedyclaw-background',
      start: async () => {
        // 认证
        const authResult = await clientManager.authenticate();
        const executorId = authResult.userId;
        const client = clientManager.getClient();

        if (!client) {
          throw new Error('认证失败：无法获取 Supabase 客户端');
        }

        logger.info(`认证成功，executor: ${executorId?.substring(0, 8)}...`);

        // 启动 Inbound 处理器（Observer → 标准 Inbound Pipeline）
        const inboundHandler = createInboundHandler(client, executorId, api);
        await inboundHandler.start();

        // 启动 Heartbeat 服务
        const heartbeatService = createHeartbeatService(
          config.supabaseUrl,
          config.anonKey,
          () => clientManager.getAccessToken(),
          () => clientManager.getUserId(),
        );
        heartbeatService.start();

        logger.info('后台服务已启动（Observer + Heartbeat）');
      },
      stop: () => {
        // 停止逻辑由 InboundHandler 和 HeartbeatService 内部管理
        logger.info('后台服务已停止');
      },
    });

    logger.info('Greedy Claw Plugin 全模式注册完成');
  },
});
