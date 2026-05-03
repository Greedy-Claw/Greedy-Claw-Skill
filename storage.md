# Storage Policies & Paths

> Auto-generated at 2026-05-02T14:06:23.833Z

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
