import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // parity tests chdir() to feed v5 its .fogg-component.yaml; forks allow that
    pool: 'forks',
    clearMocks: true,
    setupFiles: ['./vitest.setup.mts'],
  },
})
