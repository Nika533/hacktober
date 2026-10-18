import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const NODE_AND_ELECTRON = [
  'electron',
  'fs',
  'fs/promises',
  'path',
  'os',
  'child_process',
  'net',
  'crypto',
  'node:*'
]

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', '**/release', '**/test-results', '.devin/**']
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // @hoot/core runs in main, renderers, the extension and its service
    // worker: no Node, Electron, DOM or React.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...NODE_AND_ELECTRON, 'react', 'react-dom'] }]
    }
  },
  {
    // Renderers and in-page code talk to main only through window.hoot.
    files: [
      'apps/desktop/src/renderer/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
      'packages/lens-dom/src/**/*.ts',
      'packages/pdf-view/src/**/*.{ts,tsx}',
      'apps/extension/src/**/*.ts'
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: NODE_AND_ELECTRON }]
    }
  },
  {
    files: ['**/*.{js,mjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
