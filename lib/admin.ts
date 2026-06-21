// Autorización del panel de admin. La lista blanca vive en ADMIN_EMAILS (.env),
// separada por comas. No hay rol en la base: cambiar admins = cambiar el env.

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/** Devuelve la sesión si es admin; null en caso contrario. Para usar en rutas/páginas. */
export async function getAdminSession() {
  // Import diferido: mantiene isAdminEmail puro y testeable sin tocar la DB.
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) return null;
  return session;
}
