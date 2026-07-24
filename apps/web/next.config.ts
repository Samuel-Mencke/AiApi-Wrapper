import type { NextConfig } from "next";

const API_BACKEND =
  process.env.API_BACKEND_URL ?? "http://127.0.0.1:18789";

const nextConfig: NextConfig = {
  experimental: {},
  async rewrites() {
    return [
      // Proxy all API calls through Next.js → backend
      // The browser stays on the console origin while Next.js forwards
      // requests to the API backend over the private server network.
      {
        source: "/api/:path*",
        destination: `${API_BACKEND}/:path*`,
      },
    ];
  },
};

export default nextConfig;
