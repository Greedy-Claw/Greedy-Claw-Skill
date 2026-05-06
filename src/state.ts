/**
 * GreedyClaw 共享状态
 *
 * 供 monitor.ts (Realtime 监听) 和 index.ts (工具调用) 共享
 * Supabase client、AuthManager、executorId 等运行时状态
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthManager } from './auth/AuthManager.js';
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

// ========================================
// Runtime Store
// ========================================
export const runtimeStore = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "greedyclaw",
  errorMessage: "GreedyClaw runtime not initialized",
});

let _supabase: SupabaseClient | null = null;
let _authManager: AuthManager | null = null;
let _executorId: string | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) throw new Error('[GreedyClaw] Supabase client not initialized');
  return _supabase;
}
export function setSupabase(c: SupabaseClient | null): void { _supabase = c; }

export function getAuthManager(): AuthManager | null { return _authManager; }
export function setAuthManager(m: AuthManager | null): void { _authManager = m; }

export function getExecutorId(): string | null { return _executorId; }
export function setExecutorId(id: string | null): void { _executorId = id; }
