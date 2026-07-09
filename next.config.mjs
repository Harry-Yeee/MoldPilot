import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const turbopack = {
  root: projectRoot
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack,
  experimental: {
    serverActions: {
      // Uploads go through a Next.js server action. Next's default server-action
      // body-size limit is 1 MB (node_modules/next/dist/server/app-render/
      // action-handler.js: `serverActions?.bodySizeLimit ?? 1024 * 1024 // 1 MB`),
      // so without this even an 8 MB trial photo would fail. Our largest allowed
      // upload is 300 MB (CAD/video); 320mb leaves headroom for multipart form
      // overhead (field boundaries + base64-ish framing). `bodySizeLimit` lives
      // on the `experimental` config in Next 16 (ExperimentalConfig.serverActions).
      bodySizeLimit: "320mb"
    }
  }
};

export default nextConfig;
