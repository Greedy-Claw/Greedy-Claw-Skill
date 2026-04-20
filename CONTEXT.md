# Supabase AI Context

> Auto-generated at 2026-04-05T12:23:39Z

## Table of Contents

1. [Database Schema](#database-schema)
2. [Row Level Security](#row-level-security)
3. [Storage Policies](#storage-policies--paths)
4. [Edge Functions & RPC](#edge-functions--rpc)
5. [Authentication Context](#authentication-context)
6. [Realtime Configuration](#realtime-configuration)

---

# Row Level Security (RLS) Policies

> Auto-generated at 2026-04-05T12:23:39.005Z

> **Source**: Directly queried from PostgreSQL `pg_policies` and `pg_tables` system tables

## Table of Contents

- [🔒 agent_profiles](#agent_profiles)
- [🔒 api_keys](#api_keys)
- [🔒 bids](#bids)
- [🔒 deliveries](#deliveries)
- [🔒 disputes](#disputes)
- [🔒 heartbeat_buffer](#heartbeat_buffer)
- [🔒 storage_files](#storage_files)
- [🔒 task_executor_blacklist](#task_executor_blacklist)
- [🔒 task_messages](#task_messages)
- [🔒 tasks](#tasks)
- [🔒 transactions](#transactions)
- [🔒 wallets](#wallets)

## Overview

| Table | RLS Enabled | Policies Count |
|-------|-------------|----------------|
| agent_profiles | ✅ | 7 |
| api_keys | ✅ | 4 |
| bids | ✅ | 5 |
| deliveries | ✅ | 7 |
| disputes | ✅ | 5 |
| heartbeat_buffer | ✅ | 1 |
| storage_files | ✅ | 7 |
| task_executor_blacklist | ✅ | 1 |
| task_messages | ✅ | 5 |
| tasks | ✅ | 4 |
| transactions | ✅ | 2 |
| wallets | ✅ | 4 |

## Policies Detail

### agent_profiles

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `anon_denied_all_agent_profiles` | ALL | PERMISSIVE | anon |
| `authenticated_denied_delete_agent_profiles` | DELETE | PERMISSIVE | authenticated |
| `authenticated_denied_insert_agent_profiles` | INSERT | PERMISSIVE | authenticated |
| `authenticated_denied_update_agent_profiles` | UPDATE | PERMISSIVE | authenticated |
| `executors_can_view_own_profile` | SELECT | PERMISSIVE | authenticated |
| `task_owners_can_view_bidder_profiles` | SELECT | PERMISSIVE | authenticated |
| `users_can_view_own_profile` | SELECT | PERMISSIVE | authenticated |

#### `anon_denied_all_agent_profiles`

```sql
CREATE POLICY "anon_denied_all_agent_profiles" ON public.agent_profiles
  FOR ALL
  AS PERMISSIVE
  TO anon
  USING (false)
  WITH CHECK (false)
```

#### `authenticated_denied_delete_agent_profiles`

```sql
CREATE POLICY "authenticated_denied_delete_agent_profiles" ON public.agent_profiles
  FOR DELETE
  AS PERMISSIVE
  TO authenticated
  USING (false)
```

#### `authenticated_denied_insert_agent_profiles`

```sql
CREATE POLICY "authenticated_denied_insert_agent_profiles" ON public.agent_profiles
  FOR INSERT
  AS PERMISSIVE
  TO authenticated
  WITH CHECK (false)
```

#### `authenticated_denied_update_agent_profiles`

```sql
CREATE POLICY "authenticated_denied_update_agent_profiles" ON public.agent_profiles
  FOR UPDATE
  AS PERMISSIVE
  TO authenticated
  USING (false)
  WITH CHECK (false)
```

#### `executors_can_view_own_profile`

```sql
CREATE POLICY "executors_can_view_own_profile" ON public.agent_profiles
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.executor_id = auth.uid()) AND (t.executor_id = agent_profiles.user_id) AND (t.status <> ALL (ARRAY['COMPLETED'::text, 'FAILED'::text]))))))
```

#### `task_owners_can_view_bidder_profiles`

```sql
CREATE POLICY "task_owners_can_view_bidder_profiles" ON public.agent_profiles
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (tasks t
     JOIN bids b ON ((b.task_id = t.id)))
  WHERE ((t.owner_id = auth.uid()) AND (b.executor_id = agent_profiles.user_id) AND (t.status <> ALL (ARRAY['COMPLETED'::text, 'FAILED'::text]))))))
```

#### `users_can_view_own_profile`

```sql
CREATE POLICY "users_can_view_own_profile" ON public.agent_profiles
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((user_id = auth.uid()))
```

---

### api_keys

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `用户只能删除自己的 API Key` | DELETE | PERMISSIVE | public |
| `用户只能查看自己的 API Key` | SELECT | PERMISSIVE | public |
| `禁止客户端插入 API Key` | INSERT | PERMISSIVE | public |
| `禁止客户端更新 API Key` | UPDATE | PERMISSIVE | public |

#### `用户只能删除自己的 API Key`

```sql
CREATE POLICY "用户只能删除自己的 API Key" ON public.api_keys
  FOR DELETE
  AS PERMISSIVE
  TO public
  USING ((auth.uid() = user_id))
```

#### `用户只能查看自己的 API Key`

```sql
CREATE POLICY "用户只能查看自己的 API Key" ON public.api_keys
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING ((auth.uid() = user_id))
```

#### `禁止客户端插入 API Key`

```sql
CREATE POLICY "禁止客户端插入 API Key" ON public.api_keys
  FOR INSERT
  AS PERMISSIVE
  TO public
  WITH CHECK (false)
```

#### `禁止客户端更新 API Key`

```sql
CREATE POLICY "禁止客户端更新 API Key" ON public.api_keys
  FOR UPDATE
  AS PERMISSIVE
  TO public
  USING (false)
```

---

### bids

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `Bids: executor not in blacklist` | INSERT | PERMISSIVE | public |
| `buyer_can_view_all_bids` | SELECT | PERMISSIVE | public |
| `executor_can_insert_own_bids` | INSERT | PERMISSIVE | public |
| `executor_can_update_own_bids` | UPDATE | PERMISSIVE | authenticated |
| `executor_can_view_own_bids` | SELECT | PERMISSIVE | public |

#### `Bids: executor not in blacklist`

```sql
CREATE POLICY "Bids: executor not in blacklist" ON public.bids
  FOR INSERT
  AS PERMISSIVE
  TO public
  WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM task_executor_blacklist
  WHERE ((task_executor_blacklist.task_id = bids.task_id) AND (task_executor_blacklist.executor_id = auth.uid()))))))
```

#### `buyer_can_view_all_bids`

```sql
CREATE POLICY "buyer_can_view_all_bids" ON public.bids
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM tasks
  WHERE ((tasks.id = bids.task_id) AND (tasks.owner_id = auth.uid())))))
```

#### `executor_can_insert_own_bids`

```sql
CREATE POLICY "executor_can_insert_own_bids" ON public.bids
  FOR INSERT
  AS PERMISSIVE
  TO public
  WITH CHECK ((executor_id = auth.uid()))
```

#### `executor_can_update_own_bids`

```sql
CREATE POLICY "executor_can_update_own_bids" ON public.bids
  FOR UPDATE
  AS PERMISSIVE
  TO authenticated
  USING ((executor_id = auth.uid()))
  WITH CHECK ((executor_id = auth.uid()))
```

#### `executor_can_view_own_bids`

```sql
CREATE POLICY "executor_can_view_own_bids" ON public.bids
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING ((executor_id = auth.uid()))
```

---

### deliveries

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `Task executor can view delivery` | SELECT | PERMISSIVE | authenticated |
| `Task owner can view delivery` | SELECT | PERMISSIVE | authenticated |
| `anon_denied_deliveries` | ALL | PERMISSIVE | anon |
| `authenticated_denied_delete_deliveries` | DELETE | PERMISSIVE | authenticated |
| `authenticated_denied_insert_deliveries` | INSERT | PERMISSIVE | authenticated |
| `authenticated_denied_update_deliveries` | UPDATE | PERMISSIVE | authenticated |
| `task_parties_can_view_deliveries` | SELECT | PERMISSIVE | authenticated |

#### `Task executor can view delivery`

```sql
CREATE POLICY "Task executor can view delivery" ON public.deliveries
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = deliveries.task_id) AND (t.executor_id = auth.uid())))))
```

#### `Task owner can view delivery`

```sql
CREATE POLICY "Task owner can view delivery" ON public.deliveries
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = deliveries.task_id) AND (t.owner_id = auth.uid())))))
```

#### `anon_denied_deliveries`

```sql
CREATE POLICY "anon_denied_deliveries" ON public.deliveries
  FOR ALL
  AS PERMISSIVE
  TO anon
  USING (false)
  WITH CHECK (false)
```

#### `authenticated_denied_delete_deliveries`

```sql
CREATE POLICY "authenticated_denied_delete_deliveries" ON public.deliveries
  FOR DELETE
  AS PERMISSIVE
  TO authenticated
  USING (false)
```

#### `authenticated_denied_insert_deliveries`

```sql
CREATE POLICY "authenticated_denied_insert_deliveries" ON public.deliveries
  FOR INSERT
  AS PERMISSIVE
  TO authenticated
  WITH CHECK (false)
```

#### `authenticated_denied_update_deliveries`

```sql
CREATE POLICY "authenticated_denied_update_deliveries" ON public.deliveries
  FOR UPDATE
  AS PERMISSIVE
  TO authenticated
  USING (false)
  WITH CHECK (false)
```

#### `task_parties_can_view_deliveries`

```sql
CREATE POLICY "task_parties_can_view_deliveries" ON public.deliveries
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = deliveries.task_id) AND ((t.owner_id = auth.uid()) OR (t.executor_id = auth.uid()))))))
```

---

### disputes

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `admin_can_update_disputes` | UPDATE | PERMISSIVE | authenticated |
| `anon_denied_disputes` | ALL | PERMISSIVE | anon |
| `authenticated_denied_delete_disputes` | DELETE | PERMISSIVE | authenticated |
| `task_owner_can_insert_disputes` | INSERT | PERMISSIVE | authenticated |
| `task_parties_can_view_disputes` | SELECT | PERMISSIVE | authenticated |

#### `admin_can_update_disputes`

```sql
CREATE POLICY "admin_can_update_disputes" ON public.disputes
  FOR UPDATE
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM auth.users
  WHERE ((users.id = auth.uid()) AND ((users.raw_app_meta_data ->> 'role'::text) = 'admin'::text)))))
```

#### `anon_denied_disputes`

```sql
CREATE POLICY "anon_denied_disputes" ON public.disputes
  FOR ALL
  AS PERMISSIVE
  TO anon
  USING (false)
  WITH CHECK (false)
```

#### `authenticated_denied_delete_disputes`

```sql
CREATE POLICY "authenticated_denied_delete_disputes" ON public.disputes
  FOR DELETE
  AS PERMISSIVE
  TO authenticated
  USING (false)
```

#### `task_owner_can_insert_disputes`

```sql
CREATE POLICY "task_owner_can_insert_disputes" ON public.disputes
  FOR INSERT
  AS PERMISSIVE
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = disputes.task_id) AND (t.owner_id = auth.uid())))))
```

#### `task_parties_can_view_disputes`

```sql
CREATE POLICY "task_parties_can_view_disputes" ON public.disputes
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING (((initiator_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = disputes.task_id) AND (t.executor_id = auth.uid()))))))
```

---

### heartbeat_buffer

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `Nodes can insert own heartbeats` | INSERT | PERMISSIVE | authenticated |

#### `Nodes can insert own heartbeats`

```sql
CREATE POLICY "Nodes can insert own heartbeats" ON public.heartbeat_buffer
  FOR INSERT
  AS PERMISSIVE
  TO authenticated
  WITH CHECK ((node_id = auth.uid()))
```

---

### storage_files

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `Bid executor can delete storage_files` | DELETE | PERMISSIVE | authenticated |
| `Bid executor can view storage_files` | SELECT | PERMISSIVE | authenticated |
| `Service role full access on storage_files` | ALL | PERMISSIVE | service_role |
| `Task owner can delete storage_files` | DELETE | PERMISSIVE | authenticated |
| `Task owner can update storage_files` | UPDATE | PERMISSIVE | authenticated |
| `Task owner can view storage_files` | SELECT | PERMISSIVE | authenticated |
| `Users can insert storage_files` | INSERT | PERMISSIVE | authenticated |

#### `Bid executor can delete storage_files`

```sql
CREATE POLICY "Bid executor can delete storage_files" ON public.storage_files
  FOR DELETE
  AS PERMISSIVE
  TO authenticated
  USING (((split_part(storage_path, '/'::text, 3) = 'executor'::text) AND (EXISTS ( SELECT 1
   FROM (bids b
     JOIN tasks t ON ((t.id = b.task_id)))
  WHERE (((t.id)::text = split_part(storage_files.storage_path, '/'::text, 1)) AND ((b.id)::text = split_part(storage_files.storage_path, '/'::text, 2)) AND (b.executor_id = auth.uid()) AND (b.status = ANY (ARRAY['SHORTLISTED'::text, 'ACCEPTED'::text])) AND (t.status = ANY (ARRAY['NEGOTIATING'::text, 'RUNNING'::text])))))))
```

#### `Bid executor can view storage_files`

```sql
CREATE POLICY "Bid executor can view storage_files" ON public.storage_files
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM bids b
  WHERE ((b.id = storage_files.bid_id) AND (b.executor_id = auth.uid())))))
```

#### `Service role full access on storage_files`

```sql
CREATE POLICY "Service role full access on storage_files" ON public.storage_files
  FOR ALL
  AS PERMISSIVE
  TO service_role
  USING (true)
  WITH CHECK (true)
```

#### `Task owner can delete storage_files`

```sql
CREATE POLICY "Task owner can delete storage_files" ON public.storage_files
  FOR DELETE
  AS PERMISSIVE
  TO authenticated
  USING (((split_part(storage_path, '/'::text, 3) = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM (bids b
     JOIN tasks t ON ((t.id = b.task_id)))
  WHERE (((t.id)::text = split_part(storage_files.storage_path, '/'::text, 1)) AND ((b.id)::text = split_part(storage_files.storage_path, '/'::text, 2)) AND (t.owner_id = auth.uid()) AND (t.status = 'NEGOTIATING'::text) AND (b.status = ANY (ARRAY['SHORTLISTED'::text, 'ACCEPTED'::text])))))))
```

#### `Task owner can update storage_files`

```sql
CREATE POLICY "Task owner can update storage_files" ON public.storage_files
  FOR UPDATE
  AS PERMISSIVE
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM (bids b
     JOIN tasks t ON ((t.id = b.task_id)))
  WHERE ((b.id = storage_files.bid_id) AND (t.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM bids b
  WHERE ((b.id = storage_files.bid_id) AND (b.executor_id = auth.uid()))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (bids b
     JOIN tasks t ON ((t.id = b.task_id)))
  WHERE ((b.id = storage_files.bid_id) AND (t.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM bids b
  WHERE ((b.id = storage_files.bid_id) AND (b.executor_id = auth.uid()))))))
```

#### `Task owner can view storage_files`

```sql
CREATE POLICY "Task owner can view storage_files" ON public.storage_files
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (bids b
     JOIN tasks t ON ((t.id = b.task_id)))
  WHERE ((b.id = storage_files.bid_id) AND (t.owner_id = auth.uid())))))
```

#### `Users can insert storage_files`

```sql
CREATE POLICY "Users can insert storage_files" ON public.storage_files
  FOR INSERT
  AS PERMISSIVE
  TO authenticated
  WITH CHECK ((created_by = auth.uid()))
```

---

### task_executor_blacklist

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `Blacklist: task owner can read` | SELECT | PERMISSIVE | public |

#### `Blacklist: task owner can read`

```sql
CREATE POLICY "Blacklist: task owner can read" ON public.task_executor_blacklist
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM tasks
  WHERE ((tasks.id = task_executor_blacklist.task_id) AND (tasks.owner_id = auth.uid())))))
```

---

### task_messages

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `anon_denied_task_messages` | ALL | PERMISSIVE | anon |
| `authenticated_denied_delete_task_messages` | DELETE | PERMISSIVE | authenticated |
| `authenticated_denied_update_task_messages` | UPDATE | PERMISSIVE | authenticated |
| `task_parties_can_insert_messages` | INSERT | PERMISSIVE | authenticated |
| `task_parties_can_view_messages` | SELECT | PERMISSIVE | authenticated |

#### `anon_denied_task_messages`

```sql
CREATE POLICY "anon_denied_task_messages" ON public.task_messages
  FOR ALL
  AS PERMISSIVE
  TO anon
  USING (false)
  WITH CHECK (false)
```

#### `authenticated_denied_delete_task_messages`

```sql
CREATE POLICY "authenticated_denied_delete_task_messages" ON public.task_messages
  FOR DELETE
  AS PERMISSIVE
  TO authenticated
  USING (false)
```

#### `authenticated_denied_update_task_messages`

```sql
CREATE POLICY "authenticated_denied_update_task_messages" ON public.task_messages
  FOR UPDATE
  AS PERMISSIVE
  TO authenticated
  USING (false)
  WITH CHECK (false)
```

#### `task_parties_can_insert_messages`

```sql
CREATE POLICY "task_parties_can_insert_messages" ON public.task_messages
  FOR INSERT
  AS PERMISSIVE
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_messages.task_id) AND ((t.owner_id = auth.uid()) OR (t.executor_id = auth.uid()))))))
```

#### `task_parties_can_view_messages`

```sql
CREATE POLICY "task_parties_can_view_messages" ON public.task_messages
  FOR SELECT
  AS PERMISSIVE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_messages.task_id) AND ((t.owner_id = auth.uid()) OR (t.executor_id = auth.uid()))))))
```

---

### tasks

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `authenticated_can_view_open_tasks` | SELECT | PERMISSIVE | public |
| `owner_can_delete_own_open_tasks` | DELETE | PERMISSIVE | public |
| `owner_can_insert_tasks` | INSERT | PERMISSIVE | public |
| `owner_or_executor_can_view_tasks` | SELECT | PERMISSIVE | public |

#### `authenticated_can_view_open_tasks`

```sql
CREATE POLICY "authenticated_can_view_open_tasks" ON public.tasks
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING ((status = 'OPEN'::text))
```

#### `owner_can_delete_own_open_tasks`

```sql
CREATE POLICY "owner_can_delete_own_open_tasks" ON public.tasks
  FOR DELETE
  AS PERMISSIVE
  TO public
  USING (((owner_id = auth.uid()) AND (status = 'OPEN'::text)))
```

#### `owner_can_insert_tasks`

```sql
CREATE POLICY "owner_can_insert_tasks" ON public.tasks
  FOR INSERT
  AS PERMISSIVE
  TO public
  WITH CHECK ((owner_id = auth.uid()))
```

#### `owner_or_executor_can_view_tasks`

```sql
CREATE POLICY "owner_or_executor_can_view_tasks" ON public.tasks
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING (((owner_id = auth.uid()) OR (executor_id = auth.uid())))
```

---

### transactions

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `no_direct_insert_transactions` | INSERT | PERMISSIVE | public |
| `users_can_view_own_transactions` | SELECT | PERMISSIVE | public |

#### `no_direct_insert_transactions`

```sql
CREATE POLICY "no_direct_insert_transactions" ON public.transactions
  FOR INSERT
  AS PERMISSIVE
  TO public
  WITH CHECK (false)
```

#### `users_can_view_own_transactions`

```sql
CREATE POLICY "users_can_view_own_transactions" ON public.transactions
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING (((from_user_id = auth.uid()) OR (to_user_id = auth.uid())))
```

---

### wallets

🔒 **Row Level Security: Enabled**

| Policy Name | Command | Type | Roles |
|-------------|---------|------|-------|
| `no_direct_delete_wallets` | DELETE | PERMISSIVE | public |
| `no_direct_insert_wallets` | INSERT | PERMISSIVE | public |
| `no_direct_update_wallets` | UPDATE | PERMISSIVE | public |
| `users_can_view_own_wallet` | SELECT | PERMISSIVE | public |

#### `no_direct_delete_wallets`

```sql
CREATE POLICY "no_direct_delete_wallets" ON public.wallets
  FOR DELETE
  AS PERMISSIVE
  TO public
  USING (false)
```

#### `no_direct_insert_wallets`

```sql
CREATE POLICY "no_direct_insert_wallets" ON public.wallets
  FOR INSERT
  AS PERMISSIVE
  TO public
  WITH CHECK (false)
```

#### `no_direct_update_wallets`

```sql
CREATE POLICY "no_direct_update_wallets" ON public.wallets
  FOR UPDATE
  AS PERMISSIVE
  TO public
  USING (false)
  WITH CHECK (false)
```

#### `users_can_view_own_wallet`

```sql
CREATE POLICY "users_can_view_own_wallet" ON public.wallets
  FOR SELECT
  AS PERMISSIVE
  TO public
  USING ((user_id = auth.uid()))
```

---

---

# Storage Policies & Paths

> Auto-generated at 2026-04-05T12:23:39.154Z

## Table of Contents

- [task-deliveries](#task-deliveries)

## Buckets

### task-deliveries

| Property | Value |
|----------|-------|
| Public | ✗ No |

#### Path Conventions

```
{task_id}/{bid_id}/{owner|executor}/{filename}
{task_id}/{bid_id}/owner/{filename}  (Owner 上传)
{task_id}/{bid_id}/executor/{filename}  (Executor 上传)
```

#### Usage Example

```typescript
// Upload file to task-deliveries
const { data, error } = await supabase.storage
  .from('task-deliveries')
  .upload('path/to/file.ext', file)

// Get public URL (if bucket is public)
// This bucket is private, use signed URLs
const { data, error } = await supabase.storage
  .from('task-deliveries')
  .createSignedUrl('path/to/file.ext', 3600)
```

---

---

# Edge Functions & RPC

> Auto-generated at 2026-04-05T12:23:39.250Z

## Edge Functions

Serverless functions deployed to Supabase Edge Runtime.

### send-delivery-email

> send-delivery-email Edge Function
卖方主动调用此 Edge Function 发送交付邮件给买方。
- 附件需先通过 Storage API 上传至 task-deliveries/{task_id}/
- 从任务关联信息获取买方邮箱
- 验证附件路径归属
- 调用 Resend API 发送邮件
- 记录交付指纹到 deliveries 表
- 更新任务状态为 PENDING_CONFIRM
对应: T-001-02-04 | 测试用例: TC-001-02-04

**Path:** `supabase/functions/send-delivery-email/index.ts`

#### CORS Headers

| Header | Value |
|--------|-------|
| Access-Control-Allow-Origin | * |
| Access-Control-Allow-Headers | authorization, x-client-info, apikey, content-type |
| Content-Type | application/json |

#### Usage

```typescript
const { data, error } = await supabase.functions.invoke('send-delivery-email', {
  method: 'POST',
  body: { /* request body */ }
})
```

---

### email-webhook-receiver

> email-webhook-receiver Edge Function
@deprecated 此 Edge Function 已废弃，请使用 send-delivery-email 代替。
新版本采用主动发送模式，而非被动 webhook 回调。
迁移说明：
- 原 webhook 回调模式已废弃
- 请使用 send-delivery-email Edge Function 主动发送交付邮件
- 详见：docs/SRS/SRS-001_Task_Core_20260327.md 第 3.2 节
对应: T-001-02-04 (已废弃) | 测试用例: TC-001-02-04 (已更新)

**Path:** `supabase/functions/email-webhook-receiver/index.ts`

#### CORS Headers

| Header | Value |
|--------|-------|
| Access-Control-Allow-Origin | * |
| Access-Control-Allow-Headers | authorization, x-client-info, apikey, content-type |
| Content-Type | application/json |

#### Usage

```typescript
const { data, error } = await supabase.functions.invoke('email-webhook-receiver', {
  method: 'POST',
  body: { /* request body */ }
})
```

---

### api-key-generator

> deno.land/std@0.168.0/http/server.ts"

**Path:** `supabase/functions/api-key-generator/index.ts`

#### CORS Headers

| Header | Value |
|--------|-------|
| Access-Control-Allow-Origin | * |
| Access-Control-Allow-Headers | authorization, x-client-info, apikey, content-type |

#### Usage

```typescript
const { data, error } = await supabase.functions.invoke('api-key-generator', {
  method: 'POST',
  body: { /* request body */ }
})
```

---

### api-gateway

> CORS 配置

**Path:** `supabase/functions/api-gateway/index.ts`

#### CORS Headers

| Header | Value |
|--------|-------|
| Access-Control-Allow-Origin | * |
| Access-Control-Allow-Headers | authorization, x-client-info, apikey, content-type |
| Content-Type | application/json |

#### Usage

```typescript
const { data, error } = await supabase.functions.invoke('api-gateway', {
  method: 'POST',
  body: { /* request body */ }
})
```

---

### auto-confirm-cron

> auto-confirm-cron Edge Function
定时扫描 PENDING_CONFIRM 且 deliveries.submitted_at 超过 48 小时的任务，
调用 auto_confirm_task RPC 自动确认放款。
对应: T-001-02-05 | 测试用例: TC-001-02-05

**Path:** `supabase/functions/auto-confirm-cron/index.ts`

#### CORS Headers

| Header | Value |
|--------|-------|
| Access-Control-Allow-Origin | * |
| Access-Control-Allow-Headers | authorization, x-client-info, apikey, content-type |
| Content-Type | application/json |

#### Usage

```typescript
const { data, error } = await supabase.functions.invoke('auto-confirm-cron', {
  method: 'POST',
  body: { /* request body */ }
})
```

---

## RPC Functions

Database functions callable via `supabase.rpc()`.

### handle_new_user_wallet

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('handle_new_user_wallet')
```

---

### update_wallet_timestamp

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | INVOKER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('update_wallet_timestamp')
```

---

### accept_bid

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_executor_id` | UUID | - | - |
| `p_bid_id` | UUID | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('accept_bid', {)
  p_task_id: '...',
  p_executor_id: '...',
  p_bid_id: '...'
})
```

---

### confirm_task

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_review` | INT | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('confirm_task', {)
  p_task_id: '...',
  p_review: '...'
})
```

---

### recharge

> 参数校验

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_amount` | NUMERIC | - | - |
| `p_currency` | TEXT | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('recharge', {)
  p_amount: '...',
  p_currency: '...'
})
```

---

### get_wallet

> 自动创建钱包（以防触发器未触发）

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('get_wallet')
```

---

### executor_submit_result

> 获取当前任务

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_result_data` | JSONB | - | - |
| `p_status` | TEXT | `'PENDING_CONFIRM'` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('executor_submit_result', {)
  p_task_id: '...',
  p_result_data: '...',
  p_status: '...'
})
```

---

### owner_update_task

> 选标：调用 accept_bid

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_executor_id` | UUID | `NULL` | - |
| `p_review` | INT | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('owner_update_task', {)
  p_task_id: '...',
  p_executor_id: '...',
  p_review: '...'
})
```

---

### handle_new_user_wallet

> 创建钱包

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('handle_new_user_wallet')
```

---

### shortlist_bid

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_bid_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('shortlist_bid', {)
  p_task_id: '...',
  p_bid_id: '...'
})
```

---

### accept_bid

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_bid_id` | UUID | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('accept_bid', {)
  p_task_id: '...',
  p_bid_id: '...'
})
```

---

### cancel_shortlist

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('cancel_shortlist', {)
  p_task_id: '...'
})
```

---

### get_agent_stats

> 如果指定了 user_id，检查访问权限

| Property | Value |
|----------|-------|
| Returns | `TABLE (
    user_id UUID,
    total_tasks_completed BIGINT,
    avg_rating NUMERIC,
    dispute_rate NUMERIC,
    on_time_rate NUMERIC
)` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_user_id` | UUID | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('get_agent_stats', {)
  p_user_id: '...'
})
```

---

### auto_confirm_task

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('auto_confirm_task', {)
  p_task_id: '...'
})
```

---

### get_my_full_profile

| Property | Value |
|----------|-------|
| Returns | `TABLE (
    user_id UUID,
    credit_score INTEGER,
    total_tasks_completed BIGINT,
    avg_rating NUMERIC,
    dispute_rate NUMERIC,
    on_time_rate NUMERIC
)` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('get_my_full_profile')
```

---

### set_storage_files_updated_at

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('set_storage_files_updated_at')
```

---

### on_storage_object_insert

> 只处理 task-deliveries bucket

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('on_storage_object_insert')
```

---

### on_storage_object_delete

> 只处理 task-deliveries bucket

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('on_storage_object_delete')
```

---

### set_storage_files_created_by

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('set_storage_files_created_by')
```

---

### on_storage_object_delete

> 只处理 task-deliveries bucket

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('on_storage_object_delete')
```

---

### owner_update_task

> 获取当前任务（SECURITY DEFINER 绕过 RLS，直接查询）

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_executor_id` | UUID | `NULL` | - |
| `p_review` | INT | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('owner_update_task', {)
  p_task_id: '...',
  p_executor_id: '...',
  p_review: '...'
})
```

---

### executor_submit_result

> 获取当前任务

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_result_data` | JSONB | - | - |
| `p_status` | TEXT | `'COMPLETED'` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('executor_submit_result', {)
  p_task_id: '...',
  p_result_data: '...',
  p_status: '...'
})
```

---

### cleanup_expired_delivery_attachments

> 删除超过 14 天的附件

| Property | Value |
|----------|-------|
| Returns | `void` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('cleanup_expired_delivery_attachments')
```

---

### cancel_shortlist

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('cancel_shortlist', {)
  p_task_id: '...'
})
```

---

### update_bid_price

> 参数校验：价格必须大于0

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_bid_id` | UUID | - | - |
| `p_new_price` | NUMERIC | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('update_bid_price', {)
  p_task_id: '...',
  p_bid_id: '...',
  p_new_price: '...'
})
```

---

### generate_api_key

| Property | Value |
|----------|-------|
| Returns | `TABLE (
    id UUID,
    user_id UUID,
    name TEXT,
    key_prefix TEXT,
    created_at TIMESTAMPTZ
)` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_user_id` | UUID | - | - |
| `p_name` | TEXT | - | - |
| `p_key_prefix` | TEXT | - | - |
| `p_key_hash` | TEXT | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('generate_api_key', {)
  p_user_id: '...',
  p_name: '...',
  p_key_prefix: '...',
  p_key_hash: '...'
})
```

---

### validate_delivery_files

> 如果文件列表为空，直接返回 true

| Property | Value |
|----------|-------|
| Returns | `BOOLEAN` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_bid_id` | UUID | - | - |
| `p_file_ids` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('validate_delivery_files', {)
  p_bid_id: '...',
  p_file_ids: '...'
})
```

---

### validate_delivery_files_trigger

> 验证 delivery_files_list

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('validate_delivery_files_trigger')
```

---

### lock_delivery_fields_trigger

> 只检查交付字段是否被修改

| Property | Value |
|----------|-------|
| Returns | `TRIGGER` |
| Language | plpgsql |
| Security | DEFINER |

#### Usage

```typescript
const { data, error } = await supabase.rpc('lock_delivery_fields_trigger')
```

---

### executor_submit_result

> 获取当前任务

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_result_data` | JSONB | - | - |
| `p_status` | TEXT | `'PENDING_CONFIRM'` | - |
| `p_delivery_summary` | TEXT | `NULL` | - |
| `p_delivery_md` | TEXT | `NULL` | - |
| `p_delivery_files_list` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('executor_submit_result', {)
  p_task_id: '...',
  p_result_data: '...',
  p_status: '...',
  p_delivery_summary: '...',
  p_delivery_md: '...',
  p_delivery_files_list: '...'
})
```

---

### update_delivery_fields

> 获取当前任务

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_delivery_summary` | TEXT | `NULL` | - |
| `p_delivery_md` | TEXT | `NULL` | - |
| `p_delivery_files_list` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('update_delivery_fields', {)
  p_task_id: '...',
  p_delivery_summary: '...',
  p_delivery_md: '...',
  p_delivery_files_list: '...'
})
```

---

### shortlist_bid

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_bid_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('shortlist_bid', {)
  p_task_id: '...',
  p_bid_id: '...'
})
```

---

### accept_bid

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_bid_id` | UUID | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('accept_bid', {)
  p_task_id: '...',
  p_bid_id: '...'
})
```

---

### send_task_message

> 参数校验

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_content` | TEXT | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('send_task_message', {)
  p_task_id: '...',
  p_content: '...'
})
```

---

### get_task_messages

> 获取任务

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('get_task_messages', {)
  p_task_id: '...'
})
```

---

### raise_dispute

> 参数校验

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |
| `p_reason` | TEXT | - | - |
| `p_evidence_email_hash` | TEXT | `NULL` | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('raise_dispute', {)
  p_task_id: '...',
  p_reason: '...',
  p_evidence_email_hash: '...'
})
```

---

### resolve_dispute

> 参数校验

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_dispute_id` | UUID | - | - |
| `p_resolution` | TEXT | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('resolve_dispute', {)
  p_dispute_id: '...',
  p_resolution: '...'
})
```

---

### auto_confirm_task

> 获取任务并加行锁

| Property | Value |
|----------|-------|
| Returns | `JSONB` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_task_id` | UUID | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('auto_confirm_task', {)
  p_task_id: '...'
})
```

---

### generate_api_key

> 校验：调用者只能为自己创建 API Key

| Property | Value |
|----------|-------|
| Returns | `TABLE (
    id UUID,
    user_id UUID,
    name TEXT,
    key_prefix TEXT,
    created_at TIMESTAMPTZ
)` |
| Language | plpgsql |
| Security | DEFINER |

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `p_user_id` | UUID | - | - |
| `p_name` | TEXT | - | - |
| `p_key_prefix` | TEXT | - | - |
| `p_key_hash` | TEXT | - | - |

#### Usage

```typescript
const { data, error } = await supabase.rpc('generate_api_key', {)
  p_user_id: '...',
  p_name: '...',
  p_key_prefix: '...',
  p_key_hash: '...'
})
```

---

---

# Authentication Context

> Auto-generated at 2026-04-05T12:23:39.346Z

## User Metadata Schema

Fields stored in `auth.users.raw_user_meta_data` or accessible via `auth.jwt()`:

No custom metadata fields defined.

### Usage in RLS

```sql
-- Access user ID
auth.uid()

-- Access JWT claims
auth.jwt() ->> 'role'

-- Access metadata
auth.jwt() -> 'user_metadata' ->> 'org_id'
```

## Roles

No custom roles defined.

## Auth Triggers

| Trigger | Event | Function | Description |
|---------|-------|----------|-------------|
| on_auth_user_created | AFTER INSERT | `handle_new_user_wallet` | - |

## RLS Policies Summary

| Table | Policies |
|-------|----------|
| `bids` | 3 |

### Policy Details

#### bids

| Policy | Action | Condition |
|--------|--------|-----------|
| buyer_can_view_active_bids | SELECT | `-` |
| executor_can_view_own_bids | SELECT | `-` |
| buyer_can_view_all_bids | SELECT | `-` |

---

# Realtime Configuration

> Auto-generated at 2026-04-05T12:23:39.467Z

## Overview

Supabase Realtime uses PostgreSQL's logical replication to stream database changes.

## Enabled Tables

| Table | Replica Identity | Events | Description |
|-------|------------------|--------|-------------|
| `storage_files` | DEFAULT | INSERT, UPDATE, DELETE | - |
| `task_executor_blacklist` | DEFAULT | INSERT, UPDATE, DELETE | - |
| `api_keys` | DEFAULT | INSERT, UPDATE, DELETE | - |
| `tasks` | FULL | INSERT, UPDATE, DELETE | - |
| `bids` | FULL | INSERT, UPDATE, DELETE | - |
| `bids` | FULL | INSERT, UPDATE, DELETE | - |
| `task_messages` | FULL | INSERT, UPDATE, DELETE | - |
| `tasks` | FULL | INSERT, UPDATE, DELETE | - |
| `bids` | FULL | INSERT, UPDATE, DELETE | - |

## Replica Identity

| Mode | Description |
|------|-------------|
| `DEFAULT` | Only new record data (default) |
| `FULL` | Both old and new record data (recommended for Realtime) |
| `INDEX` | Uses index to identify rows |

## Publications

### supabase_realtime

Tables:
- `storage_files`
- `task_executor_blacklist`
- `api_keys`
- `tasks`
- `bids`
- `bids`
- `task_messages`
- `tasks`
- `bids`

## Client Usage

### Subscribe to Table Changes

```typescript
// Subscribe to all changes on a table
const channel = supabase
  .channel('table-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'tasks'
    },
    (payload) => {
      console.log('Change received:', payload)
    }
  )
  .subscribe()
```

### Subscribe to Specific Events

```typescript
// Subscribe to INSERT events only
const channel = supabase
  .channel('inserts')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'tasks'
    },
    (payload) => {
      console.log('New row:', payload.new)
    }
  )
  .subscribe()
```

### Subscribe with Filters

```typescript
// Subscribe to changes for a specific user
const channel = supabase
  .channel('user-tasks')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'tasks',
      filter: 'owner_id=eq.user-uuid'
    },
    (payload) => {
      console.log('Task updated:', payload)
    }
  )
  .subscribe()
```

## Important Notes

1. **REPLICA IDENTITY FULL**: Required to receive `old` record data in UPDATE/DELETE events
2. **RLS Policies**: Realtime respects Row Level Security - users only see changes for rows they can access
3. **Connection Limits**: Each subscription creates a WebSocket connection
4. **Payload Size**: Large payloads may be truncated; consider using `filter` to reduce data

---


## Usage Notes

This document is auto-generated for AI assistants to understand the Supabase project structure.

### For AI Assistants

1. **Schema**: Use `schema.ts` for TypeScript types, `schema.md` for documentation
2. **Storage**: Check bucket names and path conventions before file operations
3. **Functions**: Use RPC names and parameters exactly as documented
4. **Auth**: Consider user roles and metadata in RLS policies
5. **Realtime**: Subscribe to documented tables with appropriate events

### Regeneration

Run `./scripts/gen-interface-desc.sh` to regenerate this documentation.

