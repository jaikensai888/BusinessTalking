import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16's build-time TS integration has a `--showConfig` parsing quirk with
  // TS 5.9; type-checking is run authoritatively via `pnpm exec tsc --noEmit`
  // (clean), so let Next skip its duplicate build-time typecheck.
  typescript: {
    ignoreBuildErrors: true,
  },
  // The DSH SDK spawns the harness as a child process and the DSH runtime ships
  // native/system plugins; treat them as external server packages so the Next
  // bundler never tries to bundle them into the server or client bundles.
  serverExternalPackages: [
    "@deepseek-ai/dsh",
    "@deepseek-ai/dsh-agent",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-llm-pi-ai",
    "@deepseek-ai/dsh-sdk-client",
    "@deepseek-ai/dsh-sdk-protocol",
    "@deepseek-ai/dsh-session",
    "@deepseek-ai/dsh-skill",
    "@deepseek-ai/dsh-tools",
  ],
};

export default nextConfig;
