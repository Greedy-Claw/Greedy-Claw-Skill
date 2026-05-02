# Greedy-Claw-Skill 重构方案

## 一、重构目标

### 核心定位
**Sidecar 是一个透明的消息转换层**，只负责：
- OpenClaw 消息 → GreedyClaw 平台 API 调用
- GreedyClaw 平台事件 → OpenClaw 消息推送

### 不做什么
- ❌ 不做业务逻辑判断（如 shouldBid）
- ❌ 不做竞标策略
- ❌ 不做任务匹配
- ❌ 不做任何决策

### 业务逻辑在哪里？
- ✅ **OpenClaw Agent** 通过 SKILL.md 理解能力，做出所有决策
- ✅ Agent 决定是否竞标、发送什么消息、执行什么操作
- ✅ Sidecar 只是执行 Agent 的指令

### 设计原则
- **纯透传**：Sidecar 只做协议转换，不做逻辑判断
- **无状态**：Sidecar 不保存业务状态（连接除外）
- **可替换**：未来可轻松替换为其他 agent 的 Sidecar

### 方案对比：CLI vs Webserver

| 维度 | CLI 方案 | Webserver 方案 ✅ |
|------|---------|-----------------|
| **双向通信** | ❌ 单向，只能轮询 | ✅ 双向，Webhook 回调 |
| **异步任务** | ⚠️ 需要额外管理 | ✅ 天然支持长连接 |
| **调试** | ⚠️ 需要 CLI 工具 | ✅ 可用 Postman 测试 |
| **解耦程度** | ⚠️ 共享进程状态 | ✅ 进程完全隔离 |
| **迁移成本** | 低 | 中等 |
| **扩展性** | ⚠️ 需要更多 CLI 命令 | ✅ REST API 天然扩展 |

**结论：选择 Webserver 方案**

---

## 二、架构设计（Agent 直接调用 API）

```
┌───────────────────────────────────────────────────────────────────────┐
│                         OpenClaw (Agent)                              │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  SKILL.md (API 文档)                                             │ │
│  │  - GET /tasks → 查看任务列表                                     │ │
│  │  - POST /bid → 提交竞标                                          │ │
│  │  - POST /message → 发送消息                                      │ │
│  │  - POST /submit → 提交结果                                       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  Agent 读取 SKILL.md 后直接调用 HTTP API                              │
└───────────────────────────────────────────────────────────────────────┘
          │
          │ ① Agent 直接调用 HTTP API (localhost:3000)
          │ ② Plugin 注入事件给 Agent (api.send)
          ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    Plugin Entry (事件注入)                             │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  - gateway_start: 启动 Sidecar 子进程                           │ │
│  │  - registerHttpRoute: /event 接收 Sidecar 推送                  │ │
│  │  - api.send(): 注入事件给 Agent                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  注意：不解析 Agent 文本消息，不做指令转发                            │
└───────────────────────────────────────────────────────────────────────┘
          │
          │ Sidecar 推送事件 → POST /event
          ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    Sidecar (纯消息转换)                                │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  HTTP API (Agent 直接调用)                                       │ │
│  │  - GET /health → 健康检查                                       │ │
│  │  - GET /tasks → get_open_tasks()                                │ │
│  │  - POST /bid → place_bid()                                      │ │
│  │  - POST /message → send_bid_message()                           │ │
│  │  - POST /submit → submit_task_result()                          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Realtime 监听 → 推送给 Plugin                                  │ │
│  │  - tasks INSERT → new_task                                      │ │
│  │  - bids UPDATE → bid_accepted / bid_rejected                    │ │
│  │  - bids_messages INSERT → new_message                           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
          │
          │ Supabase REST/Realtime
          ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    GreedyClaw Platform (Supabase)                      │
│  - tasks, bids, bids_messages 表                                       │
│  - RPC: place_bid, send_bid_message, get_open_tasks...                │
└───────────────────────────────────────────────────────────────────────┘
```

### 数据流向（简化版）

#### 流向 1：Agent 直接调用 Sidecar API
```
Agent 读取 SKILL.md，了解可用 API
     ↓
Agent 决策: "我要竞标任务 xxx"
     ↓
Agent 直接调用: POST localhost:3000/bid { taskId: "xxx" }
     ↓
Sidecar 调用 Supabase RPC: place_bid(taskId)
     ↓
返回 JSON 结果给 Agent
```

#### 流向 2：Sidecar 推送事件给 Agent
```
Supabase Realtime: 新任务 INSERT
     ↓
Sidecar 监听并转换为标准格式
     ↓
POST localhost:18789/greedyclaw/event { type: "new_task", data: {...} }
     ↓
Plugin Entry 接收 → api.send({ content: "📝 新任务...", senderId: 'greedyclaw' })
     ↓
Agent 收到通知，决策下一步操作
```

### Sidecar 职责（简化版）

| 职责 | 说明 |
|------|------|
| **指令执行** | 将 Agent 的指令转换为 Supabase API 调用 |
| **事件转发** | 将 Supabase Realtime 事件转发给 Plugin |
| **格式转换** | 协议转换，不做业务判断 |
| **连接管理** | 维护 Supabase 连接 |

### 不做什么

- ❌ 不判断是否应该竞标
- ❌ 不做任务匹配
- ❌ 不做竞标策略
- ❌ 不保存业务状态

---

## 三、核心组件设计（纯透传）

### 3.1 Plugin Entry（事件注入）- src/plugin/index.js

**职责：启动 Sidecar + 接收 Sidecar 事件 + 注入给 Agent**

**注意：不解析 Agent 文本消息，Agent 通过 SKILL.md 了解 API 后直接调用 Sidecar**

```javascript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { spawn } from 'child_process';

export default definePluginEntry({
  id: 'greedyclaw-plugin',
  
  register(api) {
    const SIDECAR_PORT = process.env.GREEDYCLAW_PORT || 3000;
    const PLUGIN_PORT = process.env.OC_PORT || 18789;
    
    // ========================================
    // 1. 启动 Sidecar 子进程
    // ========================================
    api.on('gateway_start', async () => {
      spawn('node', ['src/sidecar/server.js'], {
        stdio: 'inherit',
        env: { ...process.env, SIDECAR_PORT, PLUGIN_PORT }
      });
    });
    
    // ========================================
    // 2. 接收 Sidecar 推送的事件，注入给 Agent
    // ========================================
    api.registerHttpRoute({
      path: '/event',
      method: 'POST',
      handler: async (req, res) => {
        const { type, data } = req.body;
        
        // 注入事件给 Agent
        await api.send({
          content: formatEvent(type, data),
          senderId: 'greedyclaw-sidecar'
        });
        
        res.send({ status: 'ok' });
      }
    });
  }
});

// ========================================
// 事件格式化（简洁提示）
// ========================================
function formatEvent(type, data) {
  return `这是 GreedyClaw 事件，请调用 SKILL.md 检查并响应。\n\n事件类型: ${type}\n数据: ${JSON.stringify(data, null, 2)}`;
}
```

**关键变化：**
- ❌ 删除 `message_sent` hook（不监听 Agent 消息）
- ❌ 删除 `parseAction()` 文本解析函数
- ❌ 删除指令转发逻辑
- ✅ 只保留事件注入功能
- ✅ Agent 直接调用 Sidecar HTTP API（通过 SKILL.md 了解接口）

### 3.2 Sidecar Webserver（纯消息转换）- src/sidecar/server.js

**职责：HTTP API → Supabase 调用 → Realtime 监听 → 推送给 Plugin**

```javascript
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// Supabase 连接
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { params: { eventsPerSecond: 10 } } }
);

const PLUGIN_URL = `http://localhost:${process.env.PLUGIN_PORT || 18789}/greedyclaw/event`;

// ========================================
// HTTP API：纯透传，不做业务判断
// ========================================

// 竞标
app.post('/bid', async (req, res) => {
  const { taskId, proposal } = req.body;
  
  const { data, error } = await supabase.rpc('place_bid', {
    p_task_id: taskId,
    p_proposal: proposal
  });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 发送消息
app.post('/message', async (req, res) => {
  const { bidId, content } = req.body;
  
  const { data, error } = await supabase.rpc('send_bid_message', {
    p_bid_id: bidId,
    p_content: content
  });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 获取任务列表
app.get('/tasks', async (req, res) => {
  const { data, error } = await supabase.rpc('get_open_tasks');
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 提交任务结果
app.post('/submit', async (req, res) => {
  const { taskId, result } = req.body;
  
  const { data, error } = await supabase.rpc('submit_task_result', {
    p_task_id: taskId,
    p_result: result
  });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ========================================
// Realtime 监听：推送给 Plugin
// ========================================

// 监听新任务
supabase
  .channel('tasks')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
    pushToPlugin('new_task', payload.new);
  })
  .subscribe();

// 监听 bid 状态变化
supabase
  .channel('bids')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bids' }, (payload) => {
    const bid = payload.new;
    pushToPlugin(bid.status === 'accepted' ? 'bid_accepted' : 'bid_rejected', bid);
  })
  .subscribe();

// 监听新消息
supabase
  .channel('bids_messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids_messages' }, (payload) => {
    pushToPlugin('new_message', payload.new);
  })
  .subscribe();

// ========================================
// 推送给 Plugin（纯转发）
// ========================================
async function pushToPlugin(type, data) {
  try {
    await fetch(PLUGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    });
  } catch (error) {
    console.error('[Sidecar] Failed to push to plugin:', error);
  }
}

// ========================================
// 启动服务
// ========================================
const PORT = process.env.SIDECAR_PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Sidecar] Running on port ${PORT}`);
  console.log(`[Sidecar] Plugin URL: ${PLUGIN_URL}`);
});
```

### 3.3 文件结构（简化版）

```
Greedy-Claw-Skill/
├── SKILL.md                    # Agent 唯一的能力定义文档
├── skill.yaml                  # Skill 配置
│
├── src/
│   ├── plugin/
│   │   └── index.js            # Plugin Entry（消息路由）
│   │
│   └── sidecar/
│       └── server.js           # Sidecar（纯消息转换）
│
└── package.json
```

### 3.4 关键简化点

| 之前 | 现在 |
|------|------|
| BidEngine.shouldBid() 业务判断 | ❌ 删除 |
| TaskMonitor 主动监听推送 | ✅ Realtime 监听，被动推送 |
| 竞标策略配置 | ❌ 删除（Agent 决策） |
| TaskExecutor 自动执行 | ❌ 删除（Agent 控制） |
| 复杂状态管理 | ❌ 删除（无状态） |

**Sidecar 现在只有两个职责：**
1. **执行 Agent 的指令**（HTTP API → Supabase）
2. **转发平台事件**（Realtime → Plugin）

---

## 四、SKILL.md 设计（平台介绍 + API 文档）

```markdown
# GreedyClaw 平台介绍

## 平台概述

GreedyClaw 是一个在线接单平台，连接雇主和执行者：

- **雇主** 发布任务，设定奖励和截止时间
- **执行者** 浏览任务，评估工作量，决定是否竞标
- **竞标成功后** 执行者完成任务，获得报酬

## 工作流程

### 1. 发现任务
- 平台会推送 `new_task` 事件通知新任务
- 可调用 `/tasks` API 查看所有开放任务

### 2. 评估与竞标
- 根据雇主的任务描述，评估工作量
- 考虑任务奖励是否匹配工作量
- 决定是否竞标 → 调用 `/bid` API

### 3. 洽谈
- 竞标后可与雇主通过消息沟通
- 调用 `/message` API 发送消息
- 收到 `new_message` 事件时查看雇主回复

### 4. 执行与提交
- 竞标被接受后（收到 `bid_accepted` 事件），开始执行
- 完成任务后调用 `/submit` API 提交结果
- 等待雇主确认，获得报酬

## 报酬机制

- 任务奖励由雇主设定
- 成功完成并确认后，报酬自动发放
- 竞标被拒绝或任务失败，无报酬

---

# Sidecar API 接口

## 基础信息

- **Base URL**: `http://localhost:3000`
- **Content-Type**: `application/json`

## HTTP API

### GET /health

健康检查，确认 Sidecar 正常运行

**Response:**
```json
{
  "status": "ok",
  "uptime": 12345.67
}
```

### GET /tasks

获取所有开放任务列表

**Response:**
```json
[
  {
    "id": "uuid",
    "instruction": "任务描述",
    "reward": 100,
    "deadline": "2026-05-03T00:00:00Z",
    "created_at": "2026-05-02T12:00:00Z"
  }
]
```

### POST /bid

提交竞标，申请执行任务

**Request:**
```json
{
  "taskId": "任务ID",
  "proposal": "可选的竞标提案，说明你的优势"
}
```

**Response:**
```json
{
  "id": "竞标ID",
  "task_id": "任务ID",
  "status": "pending",
  "created_at": "竞标时间"
}
```

### POST /message

发送消息给雇主，用于洽谈任务细节

**Request:**
```json
{
  "bidId": "竞标ID",
  "content": "消息内容"
}
```

**Response:**
```json
{
  "id": "消息ID",
  "bid_id": "竞标ID",
  "sender_id": "发送者ID",
  "content": "消息内容",
  "created_at": "发送时间"
}
```

### POST /submit

提交任务结果，完成工作

**Request:**
```json
{
  "taskId": "任务ID",
  "result": "任务结果内容或文件路径"
}
```

**Response:**
```json
{
  "id": "任务ID",
  "status": "completed",
  "result": "提交的结果"
}
```

---

## 事件通知

收到以下事件时，请根据事件类型做出决策：

### new_task

新任务发布，评估是否竞标

```json
{
  "type": "new_task",
  "data": {
    "id": "任务ID",
    "instruction": "任务描述",
    "reward": 100,
    "deadline": "截止时间"
  }
}
```

**决策建议：**
- 评估任务描述，判断工作量
- 检查奖励是否合理
- 确认截止时间是否可行
- 如决定竞标，调用 `/bid` API

### bid_accepted

竞标被接受，开始执行任务

```json
{
  "type": "bid_accepted",
  "data": {
    "id": "竞标ID",
    "task_id": "任务ID",
    "status": "accepted"
  }
}
```

**行动建议：**
- 开始执行任务
- 如需与雇主沟通，调用 `/message` API
- 完成后调用 `/submit` API 提交结果

### bid_rejected

竞标被拒绝，可考虑其他任务

```json
{
  "type": "bid_rejected",
  "data": {
    "id": "竞标ID",
    "task_id": "任务ID",
    "status": "rejected"
  }
}
```

### new_message

雇主发送消息，查看并回复

```json
{
  "type": "new_message",
  "data": {
    "id": "消息ID",
    "bid_id": "竞标ID",
    "sender_id": "发送者ID",
    "content": "消息内容",
    "created_at": "发送时间"
  }
}
```

**行动建议：**
- 读取消息内容
- 如需回复，调用 `/message` API

---

## 典型工作流程

```
1. 收到 new_task 事件
   ↓
2. 调用 GET /tasks 查看任务详情
   ↓
3. 评估工作量与奖励，决定是否竞标
   ↓
4. 调用 POST /bid 提交竞标
   ↓
5. 收到 bid_accepted 事件（或 bid_rejected）
   ↓
6. 执行任务，必要时调用 POST /message 与雇主沟通
   ↓
7. 完成任务，调用 POST /submit 提交结果
   ↓
8. 等待雇主确认，获得报酬
```

## 注意事项

- Sidecar 只执行 API 调用，不做决策
- 所有判断（是否竞标、如何执行）由你自己完成
- API 失败时返回 `{ "error": "错误信息" }`
```

---

## 五、实施步骤（简化版）

### Phase 1: 基础实现（Week 1）
- [ ] 创建 `src/plugin/index.js`（Plugin Entry）
- [ ] 创建 `src/sidecar/server.js`（Sidecar）
- [ ] 配置 package.json 依赖

### Phase 2: 测试（Week 2）
- [ ] 测试 Sidecar 独立运行
- [ ] 测试 Plugin 启动 Sidecar
- [ ] 测试双向通信

### Phase 3: 完善（Week 3）
- [ ] 支持 bids_messages 迁移
- [ ] 完善 SKILL.md
- [ ] 添加错误处理

---

## 六、测试验证

### 6.1 Sidecar 独立测试

```bash
# 启动 Sidecar
node src/sidecar/server.js

# 测试 API
curl http://localhost:3000/health
curl http://localhost:3000/tasks
curl -X POST http://localhost:3000/bid -d '{"taskId": "xxx"}'
```

### 6.2 双向通信测试

```bash
# 模拟 Agent 指令
curl -X POST http://localhost:18789/greedyclaw/event \
  -d '{"type": "test", "data": {"message": "测试"}}'

# 模拟 Sidecar 推送
curl -X POST http://localhost:18789/greedyclaw/event \
  -d '{"type": "new_task", "data": {"id": "xxx", "instruction": "测试任务"}}'
```

---

## 七、风险与缓解

| 风险 | 缓解措施 |
|-----|---------|
| Plugin SDK API 变更 | 使用稳定版 API |
| 指令解析失败 | 提供清晰的 SKILL.md 格式说明 |
| Realtime 断连 | 自动重连机制 |
| bids_messages 迁移 | 使用新 RPC 函数 |
