// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dist-typecheck/', 'coverage/', 'node_modules/', 'python/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['scripts/*.mjs', 'eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent / createElement.' },
        { property: 'outerHTML', message: 'Use textContent / createElement.' },
        { property: 'insertAdjacentHTML', message: 'Use createElement.' },
        { object: 'document', property: 'write', message: 'No document.write.' },
        { object: 'document', property: 'writeln', message: 'No document.writeln.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'No dynamic import().' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
