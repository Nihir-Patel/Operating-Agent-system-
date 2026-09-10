const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            '.opencode/dist/**',
            '.cursor/**',
            'node_modules/**',
            '.venv/**',
            'venv/**',
            'coverage/**',
            'workflows/**/*.workflow.*',
            '.claude/workflows/**',
            '.oas-worktrees/**',
            '.oas/**',
            'oas2/**'
        ]
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2022
            }
        },
        rules: {
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'eqeqeq': 'warn'
        }
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module'
        }
    },
    {
        files: ['apps/web/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.browser
            }
        }
    },
    {
        files: ['tests/studio-a11y-browser.test.js', 'tests/studio-operator-browser.test.js'],
        languageOptions: {
            globals: {
                ...globals.browser
            }
        }
    }
];
