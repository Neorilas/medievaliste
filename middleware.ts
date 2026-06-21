// Protege las páginas: sin sesión → redirige a /login (vía callback `authorized`).
// Las rutas /api se excluyen aquí y validan la sesión en su propio handler
// (así devuelven 401 JSON en vez de un redirect HTML).
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
