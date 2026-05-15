/**
 * GreedyClaw Channel Plugin Entry — In-Process 架构
 *
 * 架构（v7 — 与飞书一致）：
 * - 去掉 sidecar 子进程，所有逻辑在主进程内运行
 * - Realtime 监听 + 心跳 + JWT 刷新通过 monitor 长驻函数管理
 * - 工具调用直接走 Supabase client，无 HTTP 中转
 * - 心跳驱动 connected 状态 + createComputedAccountStatusAdapter（与飞书一致）
 * - 采用 Weixin 风格的消息注入管道：
 *   resolveAgentRoute → finalizeInboundContext → recordInboundSession → dispatchReplyFromConfig
 *
 * 启动路径（与飞书一致）：
 * - 框架调用 gateway.startAccount() → startMonitor() → monitorGreedyClaw() 长驻
 * - startAccount 直接返回 startMonitor() Promise，框架据此判断 running 状态
 * - 移除 gateway_start 事件，生命周期完全由框架 gateway 管理
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { greedyclawPlugin } from "./channel.js";
import { createTools } from "./tools.js";
import { runtimeStore } from "./state.js";
import { getLogger } from "./logger.js";

// ========================================
// 类型
// ========================================
interface PluginConfig {
  apiKey: string;
  apiGatewayUrl?: string;
  sidecarPort?: number;  // 保留字段兼容旧配置，但不再使用
  pluginPort?: number;   // 保留字段兼容旧配置，但不再使用
}

// ========================================
// Channel Plugin Entry
// ========================================
export default defineChannelPluginEntry({
  id: "greedyclaw",
  name: "GreedyClaw",
  description: "在线接单平台智能竞标助手",
  plugin: greedyclawPlugin,
  setRuntime: runtimeStore.setRuntime,

  registerFull(api) {
    const config = api.pluginConfig as PluginConfig;

    // ========================================
    // 注册工具
    // ========================================
    const tools = createTools();
    for (const tool of tools) {
      api.registerTool(tool, { name: tool.name });
    }
    getLogger().info(`Registered ${tools.length} tools`);

    // v7: 移除 gateway_start 事件监听
    // 生命周期完全由框架 gateway.startAccount() 管理（与飞书一致）
    // startMonitor 已在 channel.ts 的 gateway.startAccount 中直接调用
  },
});
