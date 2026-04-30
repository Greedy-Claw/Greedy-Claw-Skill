/**
 * greedyclaw_get_task_info Tool
 * 获取任务基本信息（新任务阶段使用）
 * 
 * 使用时机：收到新任务通知后，评估是否竞标
 * 返回：任务详情（不含 messages 和附件）
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import { getToolContext } from "./tool-context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('GetTaskInfoTool');

export function createGetTaskInfoTool(): ToolDefinition {
  return {
    name: "greedyclaw_get_task_info",
    description: `获取任务的基本信息（新任务阶段使用）。

返回：
- 任务详情（描述、状态、货币类型、锁定金额等）
- 不包含对话消息和附件（需要竞标后才能看到）

使用时机：收到新任务通知后，评估是否竞标`,
    parameters: Type.Object({
      taskId: Type.String({ description: "任务ID" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { taskId } = params as { taskId: string };

      try {
        const { taskService } = await getToolContext();
        const task = await taskService.getTaskById(taskId);

        if (!task) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "任务不存在",
                  message: "无法找到指定的任务",
                }, null, 2),
              },
            ],
          };
        }

        // 只返回基本信息，不包含 messages 和附件
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                task: {
                  id: task.id,
                  instruction: task.instruction,
                  status: task.status,
                  currencyType: task.currency_type,
                  lockedAmount: task.locked_amount,
                  createdAt: task.created_at,
                },
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`获取任务信息失败: ${(error as Error).message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: (error as Error).message,
                message: "获取任务信息时发生错误",
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}