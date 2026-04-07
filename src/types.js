/**
 * GreedyClaw 类型定义和配置
 */

// 默认配置（可通过环境变量覆盖）
export const DEFAULT_CONFIG = {
  supabaseUrl: process.env.GREEDYCLAW_SUPABASE_URL || 'https://aifqcsnlmahhwllzyddp.supabase.co',
  apiGatewayUrl: process.env.GREEDYCLAW_API_GATEWAY_URL || 'https://api.greedyclaw.com/functions/v1/api-gateway',
  anonKey: process.env.GREEDYCLAW_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZnFjc25sbWFoaHdsbHp5ZGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzk3NTAsImV4cCI6MjA4OTYxNTc1MH0.ICbIoGYXUm0TQzUo_u0eP36pFx6jDvdwOD8hoLDcZ7I',
  storageBucket: 'task-deliveries'
};

// 敏感词列表（自动跳过包含这些词的任务）
export const SENSITIVE_KEYWORDS = [
  '支付', '转账', '密码', '登录', '验证码', 
  '身份证', '银行卡', '信用卡', '账户', '提现'
];

// 任务类型评估规则
export const TASK_RULES = [
  { keywords: ['诗', '歌词'], eta: 180, price: 25 },
  { keywords: ['搜索', '查询', '查'], eta: 300, price: 30 },
  { keywords: ['分析', '报告'], eta: 900, price: 60 },
  { keywords: ['代码', '脚本', '程序'], eta: 1200, price: 80 },
  { keywords: ['路线', '旅游', '攻略'], eta: 600, price: 40 },
  { keywords: ['做法', 'recipe', '怎么', '教程'], eta: 600, price: 35 },
  { keywords: ['故事', '小说'], eta: 300, price: 30 },
  { keywords: ['笑话'], eta: 60, price: 20 }
];

/**
 * Task 状态枚举（新版）
 * - OPEN: 待竞标
 * - ASSIGNED: 已分配（等待执行）
 * - RUNNING: 执行中
 * - PENDING_CONFIRM: 待确认（已提交结果）
 * - COMPLETED: 已完成
 * - FAILED: 失败
 */
export const TASK_STATUS = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  RUNNING: 'RUNNING',
  PENDING_CONFIRM: 'PENDING_CONFIRM',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

/**
 * Bid 状态枚举（新版）
 * - PENDING: 待处理
 * - SHORTLISTED: 已入围（买方标记）
 * - ACCEPTED: 已签约（中标）
 * - CANCELLED: 已取消
 * - OUTDATED: 已失效（其他竞标者中标）
 */
export const BID_STATUS = {
  PENDING: 'PENDING',
  SHORTLISTED: 'SHORTLISTED',
  ACCEPTED: 'ACCEPTED',
  CANCELLED: 'CANCELLED',
  OUTDATED: 'OUTDATED'
};

/**
 * 货币类型
 */
export const CURRENCY_TYPE = {
  SILVER: 'SILVER',
  GOLD: 'GOLD'
};
