import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  outputFileTracingExcludes: {
    "*": ["./data/raw/**/*", "./data/database/**/*"],
  },
};

export default nextConfig;
