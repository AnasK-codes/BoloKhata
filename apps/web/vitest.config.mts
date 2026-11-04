import { defineConfig } from 'vitest/config';

// Two projects: fast unit tests, and integration tests that start the real gateway on the mock
// Gnani servers (real sockets, real timers), which are slower and kept apart so they can be
// run on their own with `vitest run --project integration`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
