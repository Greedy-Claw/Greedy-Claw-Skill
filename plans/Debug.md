# **OpenClaw 插件缺陷检查与修复建议**

本文档基于对 Greedy-Claw-Skill-channel\_plugins 项目代码的分析，结合 OpenClaw Channel Plugin SDK 规范，总结了当前项目无法正常运行的致命缺陷以及深度的架构设计问题，并提供了相应的修改建议。

## **1\. 致命缺陷：生命周期断层与初始化失败**

**现象描述**：

当前项目作为一个 OpenClaw 插件，其核心的初始化逻辑（Supabase 连接、工具注册、心跳启动等）被包裹在 index.ts 的 initializePlugin 函数中。然而，在 OpenClaw 插件的标准注册入口 registerFull 中，该函数**并没有被调用**，只留下了一个 TODO 注释。

**代码出处 (index.ts)**：

registerFull(\_api: PluginApi) {  
  logger.info('Greedy Claw Plugin 注册中...');  
  // TODO: 当 OpenClaw 提供账户解析钩子时，在此处调用 initializePlugin  
}

**问题影响**：

当 OpenClaw 框架加载此插件时，实质上只注册了一个“空壳” Channel。所有的 Agent Tools（如 get-balance 等）、Supabase 数据监听器以及心跳服务都不会被启动。插件处于无法工作的瘫痪状态。

**修改建议**：

必须将初始化逻辑接入到 OpenClaw 的插件生命周期中。不应该等待不存在的“账户解析钩子”，而应在 registerFull 中完成全局无状态工具的注册，在 Channel 被实例化时处理账户相关的状态。

* **参考文档**：[Building Plugins \- Lifecycle](https://github.com/openclaw/openclaw/blob/795a8042a10e074afbbf1299f74b9475f643942e/docs/plugins/building-plugins.md) (需要确保注册逻辑被正确执行)

## **2\. 架构缺陷一：反模式的 Outbound（出站）设计**

**现象描述**：

在 src/channel.ts 中，outbound.attachedResults.sendText 仅仅被实现为一个控制台打印，并没有真实的发送逻辑。相反，开发者额外创建了一个 ask-client 的 Tool，试图让 Agent 通过调用这个 Tool 来发送消息给用户。

**代码出处 (src/channel.ts)**：

outbound: {  
  attachedResults: {  
    sendText: async (ctx, payload) \=\> {  
      logger.info(\`\[Greedy Claw Channel\] 模拟发送消息到任务流: ${payload.text}\`);  
      return { messageId: 'dummy-msg-id', conversationId: ctx.conversationId };  
    }  
  }  
}

**问题影响**：

OpenClaw 核心自带一个共享的 message Tool，Agent 在需要回复用户时会默认调用它。由于当前的 sendText 是空的，Agent 的标准回复会被直接丢弃（黑洞效应）。自定义的 ask-client Tool 破坏了框架统一的消息处理流。

**修改建议**：

1. **废弃并删除** ask-client.ts 工具。  
2. 将向外部平台（Greedy Claw 任务流）发送真实消息的逻辑，实现在 channel.ts 的 outbound.attachedResults.sendText (以及 edit, react 等) 方法中。  
* **参考文档**：[Channel Plugins \- Outbound (Sending)](https://github.com/openclaw/openclaw/blob/795a8042a10e074afbbf1299f74b9475f643942e/docs/plugins/sdk-channel-plugins.md#outbound--sending-text)明确指出：“Your plugin owns: Outbound — sending text...”。

## **3\. 架构缺陷二：非标准的 Inbound（入站）分发**

**现象描述**：

当监听到 Supabase 数据库的新消息或任务时，代码在 src/inbound.ts 中使用了 api.runtime.subagent.run() 来直接唤起 Agent 处理消息。

**代码出处 (src/inbound.ts)**：

const result \= await this.api.runtime.subagent.run({  
  sessionKey: 'greedy-claw-system',  
  message: \`任务 \[${taskId}\] 收到新消息:\\n发送者: ${msg.sender\_role}\\n内容: ${msg.content}\`  
});

**问题影响**：

这种做法绕过了 OpenClaw Channel 的标准入站流（Inbound Pipeline）。直接调用底层的 subagent.run 无法让消息进入标准的上下文历史记录（Message History），也无法进行权限校验或状态追踪。

**修改建议**：

必须使用 OpenClaw 提供的 inbound-envelope 和 createChannelReplyPipeline 机制。将监听到的外部事件打包成标准的 Envelope 格式，然后通过 Pipeline 提交给核心，由核心去唤起 Agent 并维护上下文。

* **参考文档**：[Channel Plugins \- Inbound (Receiving)](https://github.com/openclaw/openclaw/blob/795a8042a10e074afbbf1299f74b9475f643942e/docs/plugins/sdk-channel-plugins.md#inbound--receiving)

## **4\. 架构缺陷三：违背多账户 (Multi-account) 隔离原则**

**现象描述**：

在 initializePlugin 中，代码执行了单例的登录，并将获取到的 executorId 硬编码注入到了各个 Tool 的工厂函数中（如 createPostBidTool）。

**问题影响**：

OpenClaw 旨在支持同一个插件配置多个账户（例如代理多个不同的 Greedy Claw 账号）。这种单例注入的方式会导致严重的上下文污染：当 Agent 试图处理账号 B 的任务时，调用的仍然是账号 A 的 executorId 和数据库客户端。

**修改建议**：

Tool 必须是无状态注册的。不要在初始化时传递单例客户端或用户 ID。而应该在 Tool 被执行时，通过传入的 RuntimeContext 动态解析当前的 accountId 或配置，然后实例化对应的 Client 发起请求。

* **参考文档**：[Channel Plugins \- Context / Resolving Session Grammar](https://github.com/openclaw/openclaw/blob/795a8042a10e074afbbf1299f74b9475f643942e/docs/plugins/sdk-channel-plugins.md#3-session-grammar)

## **5\. 架构缺陷四：缺失 messaging.resolveSessionConversation**

**现象描述**：

在定义 Channel 的配置块中（src/channel.ts），完全没有实现 messaging 相关的解析钩子。

**问题影响**：

由于外部平台（Greedy Claw）使用的是自己的 ID 体系（如 taskId），如果没有向 OpenClaw 核心解释如何将这些外部 ID 映射为 OpenClaw 内部理解的 Conversation ID 和 Thread ID，Agent 在处理多轮对话时会失去上下文，导致记忆断裂。

**修改建议**：

在 Channel 定义中必须实现 messaging.resolveSessionConversation 钩子，告诉框架如何基于传入的 payload（例如包含 taskId）来提取或生成会话与线程 ID。

* **参考文档**：[Channel Plugins \- 3\. Session grammar](https://github.com/openclaw/openclaw/blob/795a8042a10e074afbbf1299f74b9475f643942e/docs/plugins/sdk-channel-plugins.md#3-session-grammar)

## **6\. 其他问题：运行模式的混淆 (Plugin vs Daemon)**

**现象描述**：

项目中保留了基于旧有框架概念的 skill.yaml 和单独的 daemon.js / heartbeat.js 脚本。

**问题影响**：

OpenClaw 是基于 NPM 插件架构的，通过 openclaw.plugin.json 和 package.json 的配置进行加载。它不会读取 skill.yaml 来在底层操作系统派生守护进程。这些脚本在作为 OpenClaw Plugin 运行时不会被执行。

**修改建议**：

清理冗余文件，统一遵循 OpenClaw 的扩展标准。如果需要后台轮询或心跳机制，应通过 Node.js 内部的 setInterval 或 OpenClaw 提供的后台任务钩子，在 Channel 初始化（如 Channel 连接事件）时启动，并确保在插件卸载时正确清理。