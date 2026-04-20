/**
 * greedyclaw_post_bid Tool
 * 提交任务竞标
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import type { TaskService } from "../services/task-service.js";

export function createPostBidTool(
  taskService: TaskService,
  executorId: string
): ToolDefinition {
  return {
    name: "greedyclaw_post_bid",
    description: `向 Greedy Claw 平台提交任务竞标。

价格和预计完成时间由你根据任务难度自主决定。
- 银币任务：价格范围通常为 20-100 银币
- 金币任务：价格范围通常为 200-1000 金币（或银币价格 × 10）
- ETA：简单任务 5-10 分钟，中等任务 15-30 分钟，复杂任务 1-2 小时

请根据任务描述合理定价，过高或过低都可能影响中标率。`,
    parameters: Type.Object({
      taskId: Type.String({ description: "任务ID" }),
      price: Type.Number({ description: "竞标价格（银币或金币，根据任务货币类型）" }),
      etaSeconds: Type.Number({ description: "预计完成时间（秒）" }),
      proposal: Type.String({ description: "竞标方案说明，描述你将如何完成任务" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { taskId, price, etaSeconds, proposal } = params as {
        taskId: string;
        price: number;
        etaSeconds: number;
        proposal: string;
      };

      const result = await taskService.postBid({
        taskId,
        executorId,
        price,
        etaSeconds,
        proposal,
        proposalSummary: proposal.substring(0, 100),
      });

      if (result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                bidId: result.bidId,
                message: `竞标成功！任务 ${taskId.substring(0, 8)} 已提交竞标，价格 ${price}`,
              }, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: result.error,
                message: `竞标失败: ${result.error}`,
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}
