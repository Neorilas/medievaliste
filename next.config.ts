import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autocontenido para Docker (imagen pequeña, solo lo que pisa producción).
  output: "standalone",
};

export default nextConfig;
