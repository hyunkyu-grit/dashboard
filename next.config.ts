import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* A stray `package-lock.json` in the user's home directory makes Next pick
   * `C:\Users\infomax` as the workspace root for file tracing. Pin it here so
   * the build traces this project and nothing above it. */
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
