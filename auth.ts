// Config COMPLETA de Auth.js (servidor Node). Añade el adaptador de Prisma y el
// proveedor de credenciales (email/contraseña con bcrypt) sobre la base edge-safe.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { prisma } from "./lib/prisma";
import { looksLikeEmail, normalizeEmail, normalizeUsername } from "./lib/accountValidation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" }, // JWT: permite convivir Google + credenciales
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        // Un solo campo: el jugador escribe su email O su nombre de usuario.
        identifier: { label: "Email o nombre de usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(creds) {
        const identifier = (creds?.identifier as string | undefined)?.trim();
        const password = creds?.password as string | undefined;
        if (!identifier || !password) return null;

        // Si contiene @ lo tratamos como email; si no, como username (en minúsculas).
        const user = looksLikeEmail(identifier)
          ? await prisma.user.findUnique({ where: { email: normalizeEmail(identifier) } })
          : await prisma.user.findUnique({ where: { username: normalizeUsername(identifier) } });
        if (!user?.passwordHash) return null; // sin contraseña (p. ej. solo Google)

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
});
