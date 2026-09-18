const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'eslint.config.js'] },
  ...tseslint.configs.recommended
);
