import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": ["./data/raw/**/*", "./data/database/**/*"],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/data/raw/**", "**/data/database/**"],
      };
    }

    return config;
  },
};

export default nextConfig;
