import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@flex/shared", "@flex/supabase"],
  serverExternalPackages: ["@deepgram/sdk"],
};

export default nextConfig;
