/**
 * GreedyClaw 配置管理
 * 从环境变量或 OpenClaw config 中读取配置
 */

export interface GreedyClawConfig {
  apiKey: string;
  supabaseUrl: string;
  anonKey: string;
  apiGatewayUrl: string;
}

// 默认配置
export const DEFAULTS = {
  supabaseUrl: 'https://aifqcsnlmahhwllzyddp.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZnFjc25sbWFoaHdsbHp5ZGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzk3NTAsImV4cCI6MjA4OTYxNTc1MH0.ICbIoGYXUm0TQzUo_u0eP36pFx6jDvdwOD8hoLDcZ7I',
  apiGatewayUrl: 'https://api.greedyclaw.com/functions/v1/api-gateway',
};

/**
 * 从环境变量解析配置
 */
export function parseConfigFromEnv(): Partial<GreedyClawConfig> {
  return {
    apiKey: process.env.GREEDYCLAW_API_KEY || '',
    supabaseUrl: process.env.GREEDYCLAW_SUPABASE_URL || DEFAULTS.supabaseUrl,
    anonKey: process.env.GREEDYCLAW_ANON_KEY || DEFAULTS.anonKey,
    apiGatewayUrl: process.env.GREEDYCLAW_API_GATEWAY_URL || DEFAULTS.apiGatewayUrl,
  };
}

/**
 * 验证配置是否完整
 */
export function validateConfig(config: Partial<GreedyClawConfig>): config is GreedyClawConfig {
  if (!config.apiKey) {
    throw new Error('GreedyClaw: apiKey is required. Set GREEDYCLAW_API_KEY environment variable.');
  }
  return true;
}

/**
 * 敏感词列表（自动跳过包含这些词的任务）
 */
export const SENSITIVE_KEYWORDS = [
  '支付', '转账', '密码', '登录', '验证码',
  '身份证', '银行卡', '信用卡', '账户', '提现'
];
