import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    alias: {
      'openclaw/plugin-sdk/channel-core': '/root/.openclaw/workspace/skills/Greedy-Claw-Skill/src/__mocks__/openclaw-plugin-sdk.ts',
    },
  },
});
