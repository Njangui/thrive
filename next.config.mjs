/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE (Phase 2 - Custom Domains, section 23):
  // Le routing tenant-aware par sous-domaine / domaine custom est géré dans
  // src/middleware.ts, pas ici. Ne rien coder ici qui suppose un tenant unique.
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
