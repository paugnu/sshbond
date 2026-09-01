// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'node_modules/',
      '.expo/',
      'dist/',
      // Generated: a 280 KB vendored bundle that linting has nothing useful to say about.
      'src/features/terminal/xtermAssets.ts',
    ],
  },
  {
    rules: {
      // Unused arguments are common in RN callback signatures; flag variables only.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly', require: 'readonly' },
    },
  },
]);
