// Protege las páginas: sin sesión → redirige a /login (vía callback `authorized`).
// Las rutas /api se excluyen aquí y validan la sesión en su propio handler
// (así devuelven 401 JSON en vez de un redirect HTML).
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Excluye también los recursos públicos de la PWA (Cambio B): el navegador los
  // pide sin sesión (manifest e icono en la pantalla de instalación previa al
  // login, y el registro del service worker), así que no deben redirigir a /login.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon.svg|icon-maskable.svg).*)",
  ],
};
