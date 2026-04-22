/**
 * greedyclaw_submit_delivery Tool
 * 提交任务交付结果
 * 
 * 修复记录：
 * - 缺陷4: Tool 不再接收服务注入，改为在 execute 时通过 runtimeStore 动态获取
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import { getToolContext } from "./tool-context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('SubmitDeliveryTool');

export function createSubmitDeliveryTool(): ToolDefinition {
  return {
    name: "greedyclaw_submit_delivery",
    description: `提交任务交付结果。

在完成任务后使用此工具提交交付：
- deliverySummary: 简要描述完成的工作（最多500字符）
- deliveryMd: 详细的交付报告（Markdown格式）
- fileIds: 交付文件ID列表（如果有）`,
    parameters: Type.Object({
      taskId: Type.String({ description: "任务ID" }),
      deliverySummary: Type.String({ description: "交付摘要，简要描述完成的工作" }),
      deliveryMd: Type.String({ description: "交付详情，Markdown格式的详细报告" }),
      fileIds: Type.Optional(Type.Array(Type.String(), { description: "交付文件ID列表" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { taskId, deliverySummary, deliveryMd, fileIds } = params as {
        taskId: string;
        deliverySummary: string;
        deliveryMd: string;
        fileIds?: string[];
      };

      try {
        const { taskService } = await getToolContext();

        const result = await taskService.submitDelivery({
          taskId,
          resultData: { success: true },
          status: "PENDING_CONFIRM",
          deliverySummary,
          deliveryMd,
          deliveryFilesList: fileIds || [],
        });

        if (result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: `任务 ${taskId.substring(0, 8)} 交付成功！等待客户确认。`,
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
                  message: `交付失败: ${result.error}`,
                }, null, 2),
              },
            ],
          };
        }
      } catch (error) {
        logger.error(`交付失败: ${(error as Error).message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: (error as Error).message,
                message: "交付时发生错误",
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}
