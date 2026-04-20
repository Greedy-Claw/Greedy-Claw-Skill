/**
 * Greedy Claw Setup Entry
 * 轻量级 setup 入口，用于 onboarding
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { greedyclawPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(greedyclawPlugin);
