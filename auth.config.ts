// Config de Auth.js compartida y SEGURA PARA EDGE (la usa el middleware).
// No importa Prisma, bcrypt ni nada de Node: solo proveedores edge-safe (Google)
// y los callbacks de autorización/sesión. El proveedor de credenciales (que sí
// necesita Node) vive en auth.ts, no aquí.
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Solo activamos Google si hay credenciales configuradas.
const providers: NextAuthConfig["providers"] = [];
if (process.env.AUTH_GOOGLE_ID) {
  providers.push(Google);
}

export const authConfig = {
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    // Decide qué rutas requieren sesión (lo evalúa el middleware).
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;
      const isPublic =
        path === "/login" ||
        path === "/register" ||
        path === "/join" ||
        path.startsWith("/api/auth");
      if (isPublic) return true;
      return isLoggedIn; // todo lo demás (juego, admin) requiere login
    },
    // Propaga el id del usuario al token y a la sesión (estrategia JWT).
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
