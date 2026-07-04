import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const turbopack = {
  root: projectRoot
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack
};

export default nextConfig;
