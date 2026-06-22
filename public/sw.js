// Service worker mínimo (Cambio B). Su único objetivo en v1 es habilitar la
// instalabilidad de la PWA (algunos navegadores exigen un SW con manejador de
// `fetch` registrado para ofrecer la instalación). NO cachea ni intercepta nada:
// el juego necesita siempre datos frescos del servidor (fuente única de verdad).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Manejador presente a propósito, pero pasa de largo: deja que la red resuelva
// todas las peticiones con normalidad.
self.addEventListener("fetch", () => {
  // sin estrategia de caché en v1
});
