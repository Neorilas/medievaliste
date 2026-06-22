import type { MetadataRoute } from "next";

// Manifiesto PWA (Cambio B). Sirve para que el navegador ofrezca instalar la app
// en la pantalla de inicio. El icono es un SVG con sizes "any" (lo aceptan los
// navegadores basados en Chromium para la instalabilidad).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Asentamiento",
    short_name: "Asentamiento",
    description: "Gestiona tu colonia romana: recursos, colonos y crecimiento.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090b",
    theme_color: "#09090b",
    lang: "es",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
