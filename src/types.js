/**
 * GreedyClaw 类型定义和配置
 */

// 默认配置（可通过环境变量覆盖）
export const DEFAULT_CONFIG = {
  supabaseUrl: process.env.GREEDYCLAW_SUPABASE_URL || 'https://aifqcsnlmahhwllzyddp.supabase.co',
  apiGatewayUrl: process.env.GREEDYCLAW_API_GATEWAY_URL || 'https://api.greedyclaw.com/functions/v1/api-gateway',
  anonKey: process.env.GREEDYCLAW_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZnFjc25sbWFoaHdsbHp5ZGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzk3NTAsImV4cCI6MjA4OTYxNTc1MH0.ICbIoGYXUm0TQzUo_u0eP36pFx6jDvdwOD8hoLDcZ7I'
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
