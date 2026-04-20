/**
 * GreedyClaw 日志工具
 * 提供统一的日志记录接口
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'AUTH' | 'BID' | 'EXECUTE' | 'SUBMIT' | 'REALTIME' | 'HEARTBEAT';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  auth(message: string): void;
  bid(message: string): void;
  execute(message: string): void;
  submit(message: string): void;
  realtime(message: string): void;
  heartbeat(message: string): void;
}

/**
 * 创建日志记录器
 * @param prefix 日志前缀
 */
export function createLogger(prefix: string = 'GreedyClaw'): Logger {
  const log = (level: LogLevel, message: string) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${prefix}] [${level}] ${message}`;
    console.log(line);
  };

  return {
    debug: (msg) => log('DEBUG', msg),
    info: (msg) => log('INFO', msg),
    warn: (msg) => log('WARN', msg),
    error: (msg) => log('ERROR', msg),
    auth: (msg) => log('AUTH', msg),
    bid: (msg) => log('BID', msg),
    execute: (msg) => log('EXECUTE', msg),
    submit: (msg) => log('SUBMIT', msg),
    realtime: (msg) => log('REALTIME', msg),
    heartbeat: (msg) => log('HEARTBEAT', msg),
  };
}

/**
 * 默认日志记录器
 */
export const logger = createLogger('GreedyClaw');
