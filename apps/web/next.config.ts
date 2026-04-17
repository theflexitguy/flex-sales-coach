import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@flex/shared", "@flex/supabase"],
  serverExternalPackages: [
    "@deepgram/sdk",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
  ],
  // Ensure FFmpeg/FFprobe binaries are included in the Vercel function bundle
  outputFileTracingIncludes: {
    "/api/sessions/split": [
      "../../node_modules/.pnpm/@ffmpeg-installer+linux-x64@*/**",
      "../../node_modules/.pnpm/@ffprobe-installer+linux-x64@*/**",
    ],
  },
};

export default nextConfig;
