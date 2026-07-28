import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // the dark floating dev indicator is not part of the product and sat over
  // the bottom-left of the table during layout checks (carry session, Pass D)
  devIndicators: false,
};

export default nextConfig;
