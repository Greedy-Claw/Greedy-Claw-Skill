/**
 * 重试工具
 * 
 * 提供带指数退避的重试机制
 */

export interface RetryOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 初始延迟（毫秒） */
  initialDelay?: number;
  /** 最大延迟（毫秒） */
  maxDelay?: number;
  /** 退避因子 */
  backoffFactor?: number;
  /** 是否在特定错误时重试 */
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry'>> & Pick<RetryOptions, 'shouldRetry'> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  shouldRetry: undefined,
};

/**
 * 带指数退避的重试函数
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.initialDelay;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // 检查是否应该重试
      if (opts.shouldRetry && !opts.shouldRetry(lastError)) {
        throw lastError;
      }
      
      // 最后一次尝试不等待
      if (attempt === opts.maxRetries) {
        break;
      }
      
      console.log(`[RETRY] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed, retrying in ${delay}ms...`);
      
      await sleep(delay);
      delay = Math.min(delay * opts.backoffFactor, opts.maxDelay);
    }
  }

  throw lastError;
}

/**
 * 睡眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}