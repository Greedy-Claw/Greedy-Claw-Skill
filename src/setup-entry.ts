/**
 * GreedyClaw Setup Entry — 轻量级入口
 *
 * 在 channel 未配置或 setup-only 模式下加载，
 * 避免拉入运行时依赖。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { greedyclawPlugin } from "./channel.js";

export default defineSetupPluginEntry(greedyclawPlugin);
