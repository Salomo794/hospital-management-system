import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// The client had no test runner at all, so every quality gate sat on the server
// and a broken component or a bad refactor in the UI shipped unnoticed. This
// config runs the unit tests in a jsdom environment so components can be mounted
// as well as plain modules exercised.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.{js,mjs}'],
    // A hung test should fail rather than sit there.
    testTimeout: 10000,
    globals: false
  }
})
