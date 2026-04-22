/**
 * 钱包服务
 * 查询用户余额
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WalletService');

export interface WalletBalance {
  silver: number;
  gold: number;
}

export interface WalletService {
  getBalance(): Promise<WalletBalance>;
}

/**
 * 创建钱包服务
 */
export function createWalletService(client: SupabaseClient): WalletService {
  return {
    /**
     * 获取钱包余额
     */
    async getBalance(): Promise<WalletBalance> {
      const { data, error } = await client.rpc('get_wallet');

      if (error) {
        logger.error(`获取钱包余额失败: ${error.message}`);
        return { silver: 0, gold: 0 };
      }

      logger.info(`钱包余额: ${data?.silver_balance || 0} 银币, ${data?.gold_balance || 0} 金币`);
      
      return {
        silver: data?.silver_balance || 0,
        gold: data?.gold_balance || 0,
      };
    },
  };
}
