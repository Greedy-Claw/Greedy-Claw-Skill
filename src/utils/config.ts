/**
 * GreedyClaw 配置管理
 *
 * 配置来源：OpenClaw 页面配置 (openclaw.plugin.json)
 * - apiKey: 必填，用户 API Key
 * - supabaseUrl: 必填，Supabase URL
 * - apiGatewayUrl: 必填，API Gateway URL
 * - anonKey: 可选，认证后由 API Gateway 返回
 *
 * 注意：不在代码中硬编码任何默认值，所有配置均来自 OpenClaw 页面
 */

export interface GreedyClawConfig {
  apiKey: string;
  supabaseUrl: string;
  anonKey: string;
  apiGatewayUrl: string;
}

/**
 * 从环境变量解析配置（用于测试或独立运行场景）
 * 环境变量优先级高于 OpenClaw 配置
 */
export function parseConfigFromEnv(): Partial<GreedyClawConfig> {
  return {
    apiKey: process.env.GREEDYCLAW_API_KEY || '',
    supabaseUrl: process.env.GREEDYCLAW_SUPABASE_URL || '',
    anonKey: process.env.GREEDYCLAW_ANON_KEY || '',
    apiGatewayUrl: process.env.GREEDYCLAW_API_GATEWAY_URL || '',
  };
}

/**
 * 验证配置是否完整（可选验证，不强制要求）
 */
export function validateConfig(_config: Partial<GreedyClawConfig>): _config is GreedyClawConfig {
  // 不强制验证 apiKey，允许在没有配置时也能加载插件
  return true;
}

/**
 * 敏感词列表（自动跳过包含这些词的任务）
 */
export const SENSITIVE_KEYWORDS = [
  '支付', '转账', '密码', '登录', '验证码',
  '身份证', '银行卡', '信用卡', '账户', '提现'
];
