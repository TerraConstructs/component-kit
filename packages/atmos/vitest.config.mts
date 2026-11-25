import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    clearMocks: true,
    // the integration tests shell out to the atmos binary
    testTimeout: 60_000,
    setupFiles: ['./vitest.setup.mts'],
  },
})
