# **OpenClaw 插件守护进程架构设计文档 (仿 Google Chat 模式)**

## **1\. 架构概述**

本架构采用 **“Sidecar (边车) \+ 双向 Webhook”** 模式。插件不再仅仅是代码片段，而是一个微型网关。

* **Plugin Entry (OpenClaw 侧)**：作为“外交官”，负责注册 HTTP 路由、监听 AI 消息钩子。  
* **Daemon (Node.js 侧)**：作为“执行官”，负责具体的业务逻辑、硬件交互或第三方 API 对接。

## **2\. 核心组件设计**

### **A. 插件入口 (Plugin Entry)**

* **职责**：  
  * 生命周期管理：利用 gateway\_start 启动守护进程。  
  * 接入点定义：利用 api.registerHttpRoute 暴露 Webhook 端口。  
  * 消息注入：利用 api.send 将守护进程的消息转交给 AI。  
  * 消息回传：利用 api.on("message\_sent", ...) 将 AI 的回复推回守护进程。

### **B. 守护进程 (Daemon)**

* **职责**：  
  * 运行一个轻量级的 HTTP Server (如 Express)。  
  * 处理耗时任务或长连接。  
  * 格式化消息并 POST 给插件入口。

## **3\. 数据流向 (Data Flow)**

### **场景一：守护进程主动发起对话 (Daemon \-\> OpenClaw)**

1. **Daemon** 触发事件 \-\> 向 http://localhost:18789/my-plugin/webhook 发送 POST。  
2. **Plugin** 接收请求 \-\> 提取内容 \-\> 调用 api.send({ content, senderId: 'daemon' })。  
3. **OpenClaw** 触发 Agent 推理逻辑。

### **场景二：AI 回复守护进程 (OpenClaw \-\> Daemon)**

1. **AI** 生成回复内容。  
2. **Plugin** 触发 message\_sent 钩子 \-\> 判断接收者是否为 daemon。  
3. **Plugin** 向 http://localhost:3000/callback (Daemon 的端口) 发送 POST。  
4. **Daemon** 接收回复 \-\> 执行后续操作 (如控制硬件或打印日志)。

## **4\. 关键代码逻辑实现**

### **插件端 (TypeScript)**

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";  
import { spawn } from "child\_process";

export default definePluginEntry({  
  id: "my-chat-plugin",  
  register(api) {  
    // 1\. 生命周期管理：启动守护进程  
    api.on("gateway\_start", async () \=\> {  
      spawn("node", \["daemon.js"\], { stdio: 'inherit', env: { ...process.env, OC\_PORT: "18789" } });  
    });

    // 2\. 仿 Google Chat 的 Webhook 接入点  
    api.registerHttpRoute({  
      path: "/webhook",  
      method: "POST",  
      handler: async (req, res) \=\> {  
        const { text, user } \= req.body;  
        await api.send({ content: text, senderId: user });  
        res.send({ status: "success" });  
      }  
    });

    // 3\. 监听 AI 回复并推送回守护进程  
    api.on("message\_sent", async (event) \=\> {  
      if (event.recipientId \=== "daemon-user") {  
        await fetch("http://localhost:3000/ai-reply", {  
          method: "POST",  
          body: JSON.stringify({ reply: event.content })  
        });  
      }  
    });  
  }  
});

## **5\. 参考官方文档**

以下是实现该架构必须参考的 OpenClaw SDK 核心章节：

| 功能模块 | 文档路径 (docs.openclaw.ai) | 说明 |
| :---- | :---- | :---- |
| **插件生命周期** | /plugins/hooks\#gateway-lifecycle | 学习如何使用 gateway\_start 和 stop 管理子进程。 |
| **HTTP 路由注册** | /api/plugin-sdk/api\#registerhttproute | 学习如何在插件内开启 Web 接口，这是实现 Webhook 的核心。 |
| **消息钩子** | /plugins/hooks\#message-hooks | 详细了解 message\_received 和 message\_sent 的触发时机。 |
| **消息发送 API** | /api/plugin-sdk/api\#send | 学习如何以编程方式向 AI 引擎注入用户消息。 |
| **通道配置 (参考)** | /channels/googlechat | 学习 Google Chat 如何定义消息格式，帮助你设计自己的 JSON 结构。 |

## **6\. 架构优势**

1. **完全解耦**：守护进程崩溃不影响 OpenClaw，反之亦然。  
2. **异步友好**：适合处理流式数据或长时间运行的任务。  
3. **零依赖**：不需要复杂的 CLI 解析，纯 HTTP 通信，调试极其简单（用 Postman 即可测试）。