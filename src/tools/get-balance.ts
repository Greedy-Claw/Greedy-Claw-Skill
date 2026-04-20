/**
 * greedyclaw_get_balance Tool
 * 查询钱包余额
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import type { WalletService } from "../services/wallet-service.js";

export function createGetBalanceTool(walletService: WalletService): ToolDefinition {
  return {
    name: "greedyclaw_get_balance",
    description: "查询 Greedy Claw 钱包余额。返回银币和金币余额。",
    parameters: Type.Object({}),
    async execute(_id: string, _params: Record<string, unknown>) {
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
    },
  };
}
