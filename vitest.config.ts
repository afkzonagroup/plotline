import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/main.ts', 'src/app/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
