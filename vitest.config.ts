import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10_000,
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});
