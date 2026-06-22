import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autocontenido para Docker (imagen pequeña, solo lo que pisa producción).
  output: "standalone",
  async headers() {
    return [
      {
        // El service worker (Cambio B) nunca debe cachearse: así el navegador
        // siempre recoge la última versión.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
