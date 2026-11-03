import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 otherwise writes an AGENTS.md into the app folder; we keep one set of agent rules at the repo root.
  agentRules: false,
  // The shared package ships TypeScript source.
  transpilePackages: ['@bolbill/shared'],
};

export default nextConfig;
