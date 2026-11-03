import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source.
  transpilePackages: ['@bolbill/shared'],
};

export default nextConfig;
