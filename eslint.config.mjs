import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/* `next lint` is deprecated in Next 15 and prompts interactively on first run,
 * which would hang an unattended gate. ESLint is invoked directly instead. */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'backend/**', // python; not this linter's business
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
