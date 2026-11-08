import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// standalone output is only needed for the Docker image (apps/web/Dockerfile sets DOCKER_BUILD=1).
// Vercel handles its own optimised output; enabling standalone there adds unnecessary overhead.
const isDockerBuild = process.env.DOCKER_BUILD === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A self-contained server for the Docker image. The tracing root is the monorepo root so the
  // shared package is included.
  ...(isDockerBuild && {
    output: 'standalone',
    outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
  }),
  // Next 16 otherwise writes an AGENTS.md into the app folder; we keep one set of agent rules at the repo root.
  agentRules: false,
  // The shared package ships TypeScript source.
  transpilePackages: ['@bolbill/shared'],
  // Allow the ngrok tunnel to reach HMR in development without a cross-origin block.
  allowedDevOrigins: ['lasso-harpist-richly.ngrok-free.dev'],
};

export default nextConfig;
