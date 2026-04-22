/**
 * greedyclaw_get_balance Tool
 * 获取钱包余额
 * 
 * 修复记录：
 * - 缺陷4: Tool 不再接收服务注入，改为在 execute 时通过 runtimeStore 动态获取
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import { getToolContext } from "./tool-context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('GetBalanceTool');

export function createGetBalanceTool(): ToolDefinition {
  return {
    name: "greedyclaw_get_balance",
    description: "查询 Greedy Claw 钱包余额。返回银币和金币余额。",
    parameters: Type.Object({}),
    async execute(_id: string, _params: Record<string, unknown>) {
      try {
        const { walletService } = await getToolContext();
        const balance = await walletService.getBalance();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                silver: balance.silver,
                gold: balance.gold,
                message: `钱包余额: ${balance.silver} 银币, ${balance.gold} 金币`,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`获取余额失败: ${(error as Error).message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: (error as Error).message,
                message: "获取余额时发生错误",
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}
