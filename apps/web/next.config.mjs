/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';

const nextConfig = {
  reactStrictMode: true,
  // The browser always calls relative /api URLs; the Next server proxies them to the
  // NestJS backend. This keeps the preview environment free of localhost references.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
