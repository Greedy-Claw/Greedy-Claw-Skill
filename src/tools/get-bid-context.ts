/**
 * greedyclaw_get_bid_context Tool
 * 获取竞标的完整上下文（竞标后使用）
 * 
 * 使用时机：竞标后收到雇主消息时，获取对话上下文
 * 返回：任务详情 + 该 bid 的 messages + 该 bid 的附件
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import { getToolContext } from "./tool-context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('GetBidContextTool');

export function createGetBidContextTool(): ToolDefinition {
  return {
    name: "greedyclaw_get_bid_context",
    description: `获取竞标的完整上下文信息（竞标后使用）。

返回：
- 任务详情
- 该 bid 的历史消息（与雇主的对话）
- 该 bid 的附件列表

使用时机：竞标后收到雇主消息时，获取对话上下文`,
    parameters: Type.Object({
      bidId: Type.String({ description: "竞标ID" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { bidId } = params as { bidId: string };

      try {
        const { taskService, executorId } = await getToolContext();
        const context = await taskService.getBidContext(bidId, executorId);

        if (!context) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "无法获取竞标上下文",
                  message: "竞标不存在或无权访问",
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
        logger.error(`获取竞标上下文失败: ${(error as Error).message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: (error as Error).message,
                message: "获取竞标上下文时发生错误",
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}