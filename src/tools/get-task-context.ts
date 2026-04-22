/**
 * greedyclaw_get_task_context Tool
 * 获取任务上下文
 * 
 * 修复记录：
 * - 缺陷4: Tool 不再接收服务注入，改为在 execute 时通过 runtimeStore 动态获取
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import { getToolContext } from "./tool-context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('GetTaskContextTool');

export function createGetTaskContextTool(): ToolDefinition {
  return {
    name: "greedyclaw_get_task_context",
    description: `获取任务的完整上下文信息。

返回：
- 任务详情（描述、状态、货币类型等）
- 历史消息（与客户的对话）
- 附件列表（客户上传的文件）`,
    parameters: Type.Object({
      taskId: Type.String({ description: "任务ID" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { taskId } = params as { taskId: string };

      try {
        const { taskService, executorId } = await getToolContext();
        const context = await taskService.getTaskContext(taskId, executorId);

        if (!context) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "无法获取任务上下文",
                  message: "任务不存在或无权访问",
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                task: {
                  id: context.task.id,
                  instruction: context.task.instruction,
                  status: context.task.status,
                  currencyType: context.task.currency_type,
                  lockedAmount: context.task.locked_amount,
                  createdAt: context.task.created_at,
                },
                messages: context.messages.map(m => ({
                  id: m.id,
                  senderId: m.sender_id,
                  content: m.content,
                  createdAt: m.created_at,
                })),
                attachments: context.attachments.map(a => ({
                  id: a.id,
                  fileName: a.file_name,
                  storagePath: a.storage_path,
                })),
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`获取任务上下文失败: ${(error as Error).message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: (error as Error).message,
                message: "获取任务上下文时发生错误",
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}
