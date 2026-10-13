import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

// Every quality gate in this repository used to sit on the server, so a broken
// Vue template or a bad refactor in the client shipped without anything
// noticing. This config exists to catch that.
//
// It deliberately uses Vue's "essential" rule set rather than "recommended".
// Recommended adds several hundred formatting opinions - attribute wrapping,
// self-closing void tags, component names being multi-word - and turning those
// on would mean reformatting the whole client before the linter could say
// anything useful. Essential is the part that finds actual mistakes: undefined
// variables, duplicate keys, a v-for without a key, a computed property that
// mutates state, an unclosed template. Real bugs get in, style stays out.
export default [
  {
    // src/lib holds vendored third-party code (the QR generator), which is
    // written to its own style guide. Linting it produces hundreds of findings
    // about code we do not maintain and cannot safely reformat.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/lib/**']
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021
      }
    },
    rules: {
      // Worth having on top of essential, and all correctness rather than style.
      'vue/no-unused-vars': 'error',
      'vue/require-v-for-key': 'error',
      'vue/no-dupe-keys': 'error',
      'vue/no-unused-components': 'warn',
      'vue/require-default-prop': 'off',

      // router-link and router-view come from the router plugin, and the charts
      // are registered globally in main.js, so none are local components.
      'vue/no-undef-components': ['error', {
        ignorePatterns: [
          'RouterLink', 'router-link', 'RouterView', 'router-view',
          'BarChart', 'DoughnutChart', 'LineChart', 'PieChart'
        ]
      }],

      // Single-word view names are the convention in this app (Ward, Billing,
      // Reports), so requiring multi-word names would rename every view.
      'vue/multi-word-component-names': 'off',

      // This app renders icons through v-html, which is safe because the markup
      // is a local constant. Flagging every call would train everyone to ignore
      // the rule; flagging one that is bound to data would catch a real XSS.
      'vue/no-v-html': 'off',

      // caughtErrors: an empty `catch (e) {}` is a deliberate way to ignore a
      // failure, and this codebase uses it in a few optional-load paths.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'require-atomic-updates': 'off'
    }
  },
  {
    // The QR encoder legitimately matches control characters while packing bits
    // into the module map, so the rule does not apply to it.
    files: ['src/utils/qrcode.js'],
    rules: {
      'no-control-regex': 'off'
    }
  },
  {
    // Build tooling runs in Node, not the browser.
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    // Tests may log freely and run in Node.
    files: ['**/tests/**/*.{js,mjs}', '**/*.test.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-console': 'off'
    }
  }
]
