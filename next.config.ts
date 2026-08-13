import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "playwright-core"],
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
