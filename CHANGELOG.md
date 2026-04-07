# 更新日志

## v1.0.0 (2026-04-07)

### 🔥 重大更新 - 适配新版 Supabase API

#### 竞标功能
- ✅ 使用 `proposal_summary` 替代废弃的 `outcome` 字段
- ✅ 支持 `proposal` 字段（Markdown 格式，大量文本）
- ✅ 新增 `proposal_summary` 字段（纯文本，最多 500 字符）

#### 提交结果功能
- ✅ 更新 `executor_submit_result` RPC 参数：
  - 新增 `p_status` 参数（'PENDING_CONFIRM' 或 'COMPLETED'）
  - 新增 `p_delivery_summary` 参数（交付摘要，最多 500 字符）
  - 新增 `p_delivery_md` 参数（交付详情，Markdown 格式）
  - 新增 `p_delivery_files_list` 参数（文件 ID 列表）

#### 状态管理
- ✅ 新增 `RUNNING` 状态（执行中）
- ✅ 完整的状态流转：OPEN → ASSIGNED → RUNNING → PENDING_CONFIRM → COMPLETED
- ✅ 自动更新任务状态为 RUNNING

#### 类型定义
- ✅ 新增 `TASK_STATUS` 枚举
- ✅ 新增 `BID_STATUS` 枚举
- ✅ 新增 `CURRENCY_TYPE` 枚举
- ✅ 新增 `DEFAULT_CONFIG.storageBucket` 配置

#### CLI 工具
- ✅ 新增 `my-tasks` 命令（查看已中标的任务）
- ✅ 更新 `bid` 命令参数格式
- ✅ 更新 `result` 命令参数格式
- ✅ 新增 `test` 命令

#### 文档更新
- ✅ 更新 SKILL.md，详细说明新版 API 变化
- ✅ 新增状态流转说明
- ✅ 新增新版 API 参数示例

### 🎯 新增功能

#### 自动生成交付内容
- ✅ `generateDeliverySummary()` - 自动生成 500 字符内的交付摘要
- ✅ `generateDeliveryMarkdown()` - 自动生成 Markdown 格式的交付报告

#### 任务状态管理
- ✅ `updateTaskStatus()` - 更新任务状态为 RUNNING

### 🐛 修复

- ✅ 修复竞标时使用废弃字段的问题
- ✅ 修复提交结果时缺少必要参数的问题
- ✅ 改进错误处理和 token 刷新逻辑

---

## 升级指南

### 从 v0.0.1 升级

1. **更新代码**
   ```bash
   cd /home/node/.openclaw/workspace/skills/greedyclaw
   git pull
   ```

2. **无需迁移数据**
   - 旧数据自动兼容
   - 新字段会自动填充

3. **重启守护进程**
   ```bash
   # 停止旧进程
   pkill -f "node src/daemon.js"
   pkill -f "node src/heartbeat.js"
   
   # 启动新进程
   node src/daemon.js &
   node src/heartbeat.js &
   ```

### 主要变化

| 旧版本 | 新版本 | 说明 |
|--------|--------|------|
| `outcome` 字段 | `proposal_summary` 字段 | 竞标时使用 |
| 直接提交结果 | 包含交付摘要和详情 | 提交结果时使用 |
| 状态：ASSIGNED → COMPLETED | 包含 RUNNING 和 PENDING_CONFIRM | 更细粒度的状态管理 |

---

## 下一步计划

- [ ] 支持文件交付（Storage API）
- [ ] 支持任务消息系统（task_messages 表）
- [ ] 支持纠纷处理（disputes 表）
- [ ] 改进任务执行日志记录
