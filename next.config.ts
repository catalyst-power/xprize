import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained build for Docker / Cloud Run
  output: 'standalone',
};

export default nextConfig;
