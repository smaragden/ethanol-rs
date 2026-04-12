import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NODE_ENV === "production" ? "/ethanol-rs" : "",
  images: { unoptimized: true },
  turbopack: {
    root: resolve(__dirname),
    rules: {
      "*.wasm": { type: "wasm" },
    },
  },
  webpack(config) {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

export default nextConfig;
