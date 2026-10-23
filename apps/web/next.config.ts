import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Keep the dev server's output away from the production build's.
   *
   * Both default to `.next`. Running `pnpm build` while `pnpm dev` is up
   * therefore replaces the chunks the running dev server is serving, and every
   * subsequent request 404s until it is restarted — which looks like the app
   * breaking for no reason, with no error that names the cause.
   *
   * `next dev` sets NODE_ENV=development before loading this file; `next build`
   * and `next start` both set production, so they continue to agree on `.next`
   * and nothing about deployment changes.
   */
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // This repo is a pnpm workspace; pin the trace root so Next does not walk up
  // and find an unrelated lockfile in a parent directory.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@dnd/contracts'],
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // Proxy API calls so the browser talks to one origin (avoids CORS in dev).
    const target = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
