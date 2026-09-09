// @ts-check

import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pluginReact from '@eslint-react/eslint-plugin';
import {includeIgnoreFile} from '@eslint/config-helpers';
import pluginJs from '@eslint/js';
import pluginQuery from '@tanstack/eslint-plugin-query';
import * as tsParser from '@typescript-eslint/parser';
import pluginJest from 'eslint-plugin-jest';
import pluginTestingLibrary from 'eslint-plugin-testing-library';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginReactCompiler from 'eslint-plugin-react-compiler';
import globals from 'globals';
import pluginTs from 'typescript-eslint';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const pluginIntl = require('./eslint-rules/intl.js');
const pluginReactNativeCustom = require('./eslint-rules/react-native.js');
const pluginStorybookCustom = require('./eslint-rules/storybook.js');

const gitignorePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.gitignore',
);

const gitExcludePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.git',
  'info',
  'exclude',
);

const toolingConfig = pluginTs.config({
  name: 'tooling',
  files: [
    '*.config.{js,mjs,cjs}',
    'scripts/**/*.{js,mjs,cjs}',
    'expo-config-plugins/*.{js,mjs,cjs}',
    'expo-config-plugins/**/*.{js,mjs,cjs}',
    '.claude/skills/**/*.{js,mjs,cjs}',
  ],
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.nodeBuiltin,
      ...globals.worker,
    },
  },
});

const backendConfig = pluginTs.config({
  name: 'backend',
  files: ['src/backend/**/*.{js,ts}'],
  extends: [pluginTs.configs.recommended],
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.nodeBuiltin,
      ...globals.worker,
    },
  },
});

/**
 * R1 bundling: package/ZIP handling is Node-only (scripts/). The RN bundle
 * (src/frontend) must never import comapeocat, yauzl-promise or Node
 * built-ins — embedded package manifests are generated at build time
 * (`npm run build:manifestos-pacotes`). TEST files run in the jest Node
 * environment and never enter the bundle, so the 'tests' block below only
 * bans the bundle-poisoning packages: it re-allows Node built-ins and
 * `comapeocat/writer.js` (tests build REAL `.comapeocat` fixtures with it) —
 * package READING in tests must go through `scripts/lib/manifesto-pacote.mjs`.
 */
const NODE_ONLY_IMPORT_MESSAGE =
  'Node-only module (R1 bundling): package/ZIP handling lives in scripts/ — the RN bundle must stay free of comapeocat, yauzl-promise and Node built-ins. Use the generated manifestos (scripts/gerar-manifestos-pacotes.mjs).';
const NODE_ONLY_IMPORT_GROUP = [
  'comapeocat',
  'comapeocat/*',
  'yauzl-promise',
  'yauzl-promise/*',
  'fs',
  'fs/*',
  'node:fs',
  'node:fs/*',
  'zlib',
  'node:zlib',
  'stream',
  'stream/*',
  'node:stream',
  'node:stream/*',
];

const frontendConfig = pluginTs.config(
  {
    name: 'frontend',
    files: ['src/frontend/**/*.{js,jsx,ts,tsx}'],
    extends: [
      pluginTs.configs.recommended,
      pluginQuery.configs['flat/recommended'],
      pluginReact.configs['recommended-typescript'],
      pluginReact.configs['disable-dom'],
      pluginReactCompiler.configs['recommended'],
      pluginReactHooks.configs.flat['recommended-latest'],
    ],
    plugins: {
      intl: pluginIntl,
      'react-native': pluginReactNativeCustom,
      storybook: pluginStorybookCustom,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {group: NODE_ONLY_IMPORT_GROUP, message: NODE_ONLY_IMPORT_MESSAGE},
          ],
        },
      ],
      'intl/no-unused-message-descriptors': 'error',
      'intl/no-duplicate-message-descriptor-ids': 'error',
      'react-native/no-single-element-style-arrays': 'error',
      // Storybook-only seams live in app source and look like supported API.
      // Switched off for *.stories.tsx below, which is the only legitimate
      // caller. See eslint-rules/storybook.js and .rnstorybook/README.md.
      'storybook/no-seam-outside-stories': [
        'error',
        {
          seams: [
            {
              component: 'ExchangeScreenContent',
              prop: 'overrides',
              types: ['ExchangeScreenContentOverrides'],
            },
          ],
        },
      ],
      // Duplicate of react-hooks/set-state-in-effect, already set to warn below
      '@eslint-react/set-state-in-effect': 'off',
      // Some React Native libraries use the subscription return approach
      '@eslint-react/web-api/no-leaked-event-listener': 'off',
      // Not relevant for React Native
      '@eslint-react/web-api/no-leaked-resize-observer': 'off',
      // Not relevant for React Native (no DOM setTimeout cleanup needed)
      '@eslint-react/web-api-no-leaked-timeout': 'off',
      // useContext is still valid
      '@eslint-react/no-use-context': 'off',
      // Mock functions legitimately use 'use' prefix to match real hook names
      '@eslint-react/no-unnecessary-use-prefix': 'off',
      // new Date() during render is acceptable in React Native (no hydration concerns)
      '@eslint-react/purity': 'off',
      // Naming conventions/ style preference not traditionally used by us
      '@eslint-react/naming-convention-ref-name': 'off',
      // There are some cases in app code when it's needed
      '@typescript-eslint/no-require-imports': 'off',
      // Requires ES2022 error lib for {cause} support — not in our tsconfig base
      'preserve-caught-error': 'off',
      // We want to strictly adhere
      'react-hooks/exhaustive-deps': 'error',
      // We want to strictly adhere
      'react-hooks/rules-of-hooks': 'error',
    },
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    name: 'stories',
    files: ['src/frontend/**/*.stories.{js,jsx,ts,tsx}'],
    rules: {
      // The one place a Storybook-only seam is allowed to be used.
      'storybook/no-seam-outside-stories': 'off',
    },
  },
  {
    name: 'tests',
    files: [
      'src/frontend/**/*.test.{js,jsx,mts,ts,tsx}',
      'src/frontend/**/__mocks__/**',
    ],
    extends: [
      pluginJest.configs['flat/recommended'],
      pluginTestingLibrary.configs['flat/react'],
    ],
    rules: {
      // Same R1 ban for the bundle-poisoning packages, but tests run in the
      // jest Node environment (never bundled): Node built-ins stay allowed
      // (e.g. packageJson.test.ts, metrics/sendMetricsData.test.ts) and
      // `comapeocat/writer.js` builds the REAL `.comapeocat` fixtures — the
      // only re-allowed comapeocat specifier (the group form cannot express
      // exceptions under a directory ban, hence the regex with a negative
      // lookahead).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(?:comapeocat|comapeocat/(?!writer\\.js$).+|yauzl-promise(?:/.*)?)$',
              message: NODE_ONLY_IMPORT_MESSAGE,
            },
          ],
        },
      ],
      // Mostly conventional and doesn't have significant impact on how tests work
      'testing-library/render-result-naming-convention': 'off',
      '@eslint-react/hooks-extra/no-unnecessary-use-prefix': 'off',
      '@eslint-react/hooks-extra/no-useless-custom-hooks': 'off',
      // In @testing-library/react-native v14, fireEvent (and render/rerender)
      // became async and MUST be awaited — unlike the DOM library the plugin's
      // 'react' preset assumes. Require awaiting fireEvent, and stop forbidding it.
      'testing-library/await-async-events': [
        'error',
        {eventModule: ['fireEvent', 'userEvent']},
      ],
      'testing-library/no-await-sync-events': 'off',
    },
  },
);

export default pluginTs.config(
  {ignores: ['e2e/**/*']},
  includeIgnoreFile(gitignorePath),
  // A linked git worktree has `.git` as a pointer file, not a directory, so
  // `.git/info/exclude` does not exist there.
  ...(existsSync(gitExcludePath) ? [includeIgnoreFile(gitExcludePath)] : []),
  pluginJs.configs.recommended,
  toolingConfig,
  backendConfig,
  frontendConfig,
);
