/**
 * GreedyClaw 统一日志模块
 *
 * 参考 openclaw-lark 的 larkLogger 实现：
 * - 通过 PluginRuntime.logging.getChildLogger() 获取结构化 logger
 * - runtime 未初始化时 fallback 到带颜色的 console 输出
 * - 支持子系统分类 (child)
 * - 每次调用懒加载 runtime logger（不缓存失效引用）
 */

import type { RuntimeLogger } from "openclaw/plugin-sdk/runtime-store";
import { runtimeStore } from "./state.js";

// ========================================
// Public interface
// ========================================
export interface GreedyClawLogger {
  readonly subsystem: string;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(name: string): GreedyClawLogger;
}

// ========================================
// Console fallback (with ANSI colors)
// ========================================
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function consoleFallback(subsystem: string): RuntimeLogger {
  const tag = `greedyclaw/${subsystem}`;
  return {
    debug: (msg, meta) => console.debug(`${GRAY}[${tag}]${RESET}`, msg, ...(meta ? [meta] : [])),
    info: (msg, meta) => console.log(`${CYAN}[${tag}]${RESET}`, msg, ...(meta ? [meta] : [])),
    warn: (msg, meta) => console.warn(`${YELLOW}[${tag}]${RESET}`, msg, ...(meta ? [meta] : [])),
    error: (msg, meta) => console.error(`${RED}[${tag}]${RESET}`, msg, ...(meta ? [meta] : [])),
  };
}

// ========================================
// Lazy runtime resolution
// ========================================
function resolveRuntimeLogger(subsystem: string): RuntimeLogger | null {
  try {
    const runtime = runtimeStore.tryGetRuntime();
    if (!runtime?.logging) return null;
    return runtime.logging.getChildLogger({
      subsystem: `greedyclaw/${subsystem}`,
    });
  } catch {
    return null;
  }
}

// ========================================
// Message formatting
// ========================================

/**
 * Format message with inline meta for text-based log output.
 *
 * RuntimeLogger implementations typically ignore the `meta` parameter in
 * their text output. To ensure meta is always visible, we serialize
 * user-supplied meta into the message string.
 */
function formatMessage(message: string, meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return `greedyclaw: ${message}`;
  const parts = Object.entries(meta)
    .map(([k, v]) => {
      if (v === undefined || v == null) return null;
      if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    })
    .filter(Boolean);
  return parts.length > 0
    ? `greedyclaw: ${message} (${parts.join(', ')})`
    : `greedyclaw: ${message}`;
}

// ========================================
// GreedyClawLogger implementation
// ========================================
function createLogger(subsystem: string): GreedyClawLogger {
  let cachedLogger: RuntimeLogger | null = null;
  let resolved = false;

  function getLogger(): RuntimeLogger {
    if (!resolved) {
      cachedLogger = resolveRuntimeLogger(subsystem);
      if (cachedLogger) resolved = true;
    }
    return cachedLogger ?? consoleFallback(subsystem);
  }

  return {
    subsystem,

    debug(message: string, meta?: Record<string, unknown>): void {
      getLogger().debug?.(formatMessage(message, meta), meta);
    },
    info(message: string, meta?: Record<string, unknown>): void {
      getLogger().info(formatMessage(message, meta), meta);
    },
    warn(message: string, meta?: Record<string, unknown>): void {
      getLogger().warn(formatMessage(message, meta), meta);
    },
    error(message: string, meta?: Record<string, unknown>): void {
      getLogger().error(formatMessage(message, meta), meta);
    },
    child(name: string): GreedyClawLogger {
      return createLogger(`${subsystem}/${name}`);
    },
  };
}

// ========================================
// Public API
// ========================================

/** 主 logger 实例 */
const rootLogger = createLogger('core');

/** 获取主 logger */
export function getLogger(): GreedyClawLogger {
  return rootLogger;
}

/** 创建子系统 logger（等价于 getLogger().child(name)） */
export function createSubLogger(name: string): GreedyClawLogger {
  return rootLogger.child(name);
}
