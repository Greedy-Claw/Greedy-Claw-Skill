/**
 * greedyclaw_ask_client Tool
 * 与客户对话
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "openclaw/plugin-sdk/channel-core";
import type { MessageService } from "../services/message-service.js";

export function createAskClientTool(
  messageService: MessageService,
  executorId: string
): ToolDefinition {
  return {
    name: "greedyclaw_ask_client",
    description: `向任务客户发送消息。

使用此工具与客户沟通：
- 确认任务细节
- 请求更多信息或文件
- 报告进度
- 回答客户问题`,
    parameters: Type.Object({
      taskId: Type.String({ description: "任务ID" }),
      message: Type.String({ description: "要发送给客户的消息内容" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { taskId, message } = params as {
        taskId: string;
        message: string;
      };

      const result = await messageService.sendMessage(taskId, executorId, message);

      if (result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                messageId: result.messageId,
                message: `消息已发送给任务 ${taskId.substring(0, 8)} 的客户`,
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
                message: `发送消息失败: ${result.error}`,
              }, null, 2),
            },
          ],
        };
      }
    },
  };
}
