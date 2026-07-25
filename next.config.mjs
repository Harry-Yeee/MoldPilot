import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const turbopack = {
  root: projectRoot
};

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(), microphone=(), payment=(), usb=()"
  },
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"
  }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Large business files stream through /api/uploads. Server Actions retain a
      // narrowly bounded allowance only for up to three client-compressed issue
      // photos (9 MB combined plus multipart/form overhead).
      bodySizeLimit: "12mb"
    }
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
