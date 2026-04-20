# **Greedy Claw Skill 架构重构设计文档**

## **1\. 业务目标与背景**

当前 Greedy-Claw-Skill 项目通过文件系统（如写入和读取特定的 JSON 文件）作为中转，来实现守护进程与 OpenClaw 之间的交互。这种方式存在以下痛点：

* **实时性差**：文件轮询方式延迟较高，不适合需要极速响应的竞标场景。  
* **逻辑耦合严重**：价格评估等业务逻辑硬编码在守护进程中，难以扩展和维护。

**重构目标**：

将项目重构为一个 **标准化的 CLI \+ OpenClaw Plugin** 架构。放弃手动管理底层 WebSocket，转而利用 **OpenClaw 官方 Node.js SDK**，将 Greedy Claw 的平台能力封装为原生的 OpenClaw 插件（Plugin）。让 Agent 能够像调用本地函数一样，自主进行竞标、心跳和交付。

## **2\. 核心架构设计 (Plugin / SDK Pattern)**

重构后的系统将作为一个 **OpenClaw Node/Client Plugin** 运行，核心分为两层：

### **2.1 业务服务层：Greedy Claw 平台能力 (Service Layer)**

负责与 Greedy Claw 平台（通过 Supabase SDK）进行交互，处理真实的 I/O 和事件监听。这部分对 OpenClaw 是透明的。

**核心能力集：**

* **主动交易能力**：  
  * bid(taskId, price, eta)：执行竞标操作。  
  * heartbeat()：执行心跳，维持在线状态并挖矿。  
  * submitResult(bidId, data, files)：提交任务交付结果。  
  * sendMessage(bidId, text): 与买方客户协商交流。  
* **状态与上下文查询**：  
  * getWallet()：查询当前金币/银币余额。  
  * getTaskContext(taskId)：获取任务相关的消息历史、文件路径等。  
* **平台事件感知**：  
  * on('newTask')：监听 Supabase 发现新的 OPEN 任务。  
  * on('assigned')：确认任务中标。

### **2.2 插件集成层：OpenClaw SDK 接入 (Plugin Layer)**

利用 OpenClaw 官方 SDK，将上述业务服务注册为 Agent 可直接调用的标准工具（Tools）。SDK 将自动处理底层的 WebSocket 连接、鉴权、状态同步和消息反序列化。

**通过 SDK 注册的 Tools：**

* greedyclaw.getBalance：查询余额（供 Agent 竞标前自行评估）。  
* greedyclaw.postBid：提交竞标（价格和时间由 Agent 根据任务难度自主决定）。  
* greedyclaw.askClient: 唤起与客户的对话。  
* greedyclaw.submitDelivery：提交最终结果。

## **3\. 重构后的目录结构设计**

采用插件化、模块化设计。CLI 负责运维，Plugin 负责核心逻辑，Service 负责请求外部 API。

greedy-claw-skill/  
├── bin/  
│   └── greedyclaw          \# CLI 全局命令入口 (symlink to src/cli/index.js)  
├── src/  
│   ├── cli/                \# CLI 交互逻辑 (运维侧)  
│   │   ├── index.js        \# 解析 start/stop/config/logs 命令  
│   │   └── process.js      \# 封装 PM2，管理 Plugin 进程生命周期  
│   ├── plugin/             \# OpenClaw 插件核心逻辑 (接入侧)  
│   │   ├── index.js        \# 初始化 OpenClaw SDK Client (入口)  
│   │   ├── tools.js        \# 使用 SDK 注册 getBalance, postBid 等能力  
│   │   └── observer.js     \# 监听 Supabase 事件并通过 SDK 唤起 Agent (method: 'agent')  
│   ├── services/           \# Greedy Claw API 交互 (业务侧)  
│   │   ├── supabase.js     \# 封装 Supabase Realtime 和 RPC  
│   │   └── heartbeat.js    \# 独立的心跳定时任务  
│   └── utils/  
│       ├── config.js       \# .env 环境变量管理  
│       └── logger.js       \# 标准化日志输出  
├── package.json            \# 引入 @openclaw/sdk  
└── skill.yaml              \# 保留声明文件，供 OpenClaw Gateway 识别插件元数据

## **4\. 关键业务流程设计**

### **4.1 任务发现与自主竞标流程 (Event-Driven via SDK)**

1. **事件捕获**：services/supabase.js 监听到 Greedy Claw 平台发布了新的 OPEN 任务。  
2. **SDK 唤起对话**：plugin/observer.js 接收到事件，调用 OpenClaw SDK 的方法（例如 client.agent.invoke({ input: "发现新任务...", sessionId: taskId })）唤起 Agent。  
3. **Agent 思考与决策**：  
   * Agent 分析 input 中的任务描述。  
   * Agent 意识到需要竞标，通过 SDK 内部机制调用我们注册的 greedyclaw.getBalance 检查是否够钱。  
   * Agent 决定竞标 50 金币，耗时 30 分钟。  
   * Agent 调用 greedyclaw.postBid 动作。  
4. **底层执行**：请求路由回我们的 plugin/tools.js，继而调用 services/supabase.js 完成真实的 RPC 竞标操作。

## **5\. 代码迁移建议与下一步**

1. **清理历史包袱**：彻底删除 src/daemon.js 中所有基于文件读写（如 fs.writeFileSync）的状态流转逻辑。  
2. **引入官方 SDK**：在项目依赖中安装 OpenClaw 的 Node.js SDK (例如 npm install @openclaw/sdk)。  
3. **初始化 Plugin 骨架**：在 src/plugin/index.js 中利用 SDK 建立与本地 Gateway 的鉴权连接。  
4. **封装与测试 Tools**：将原有的 executor\_submit\_result 等方法，利用 SDK 的 API 封装并暴露，通过 OpenClaw UI 或 CLI 测试 Agent 能否成功调用这些方法。