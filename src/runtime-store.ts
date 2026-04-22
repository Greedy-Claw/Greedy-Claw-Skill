/**
 * Plugin Runtime Store
 * 用于在 register 回调外访问 runtime（如 outbound handlers、Tool execute）
 * 
 * 使用方式：
 * 1. 在 index.ts 的 defineChannelPluginEntry 中设置 setRuntime
 * 2. 在 outbound.sendText 或 Tool execute 中通过 getRuntimeStore().getRuntime() 获取
 */

import type { PluginRuntime } from 'openclaw/plugin-sdk/channel-core';
import type { PluginRuntimeStore } from 'openclaw/plugin-sdk/runtime-store';

let runtimeStore: PluginRuntimeStore | null = null;

/**
 * 初始化 Runtime Store
 * 在插件入口调用
 */
export function initRuntimeStore(): PluginRuntimeStore {
  if (runtimeStore) {
    return runtimeStore;
  }

  let _runtime: PluginRuntime | null = null;

  runtimeStore = {
    getRuntime(): PluginRuntime {
      if (!_runtime) {
        throw new Error('Runtime 未设置，请确保在 defineChannelPluginEntry 中配置了 setRuntime');
      }
      return _runtime;
    },

    setRuntime(runtime: PluginRuntime): void {
      _runtime = runtime;
    },

    hasRuntime(): boolean {
      return _runtime !== null;
    },
  };

  return runtimeStore;
}

/**
 * 获取 Runtime Store
 * 在 outbound handlers 和 Tool execute 中使用
 */
export function getRuntimeStore(): PluginRuntimeStore {
  if (!runtimeStore) {
    throw new Error('Runtime Store 未初始化，请先调用 initRuntimeStore()');
  }
  return runtimeStore;
}
