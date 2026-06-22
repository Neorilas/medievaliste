// ============================================================================
// accountValidation.ts — validación PURA de datos de cuenta (sin DB).
//
// Reglas de email, username y contraseña del registro. Sin efectos secundarios
// para poder testearlas en aislamiento; la unicidad (que sí toca la DB) se
// comprueba aparte en la ruta de registro.
// ============================================================================

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

export const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Normaliza un email para almacenamiento/comparación. */
export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

/**
 * Normaliza un username para comparación de unicidad. Se compara y almacena en
 * minúsculas (la unicidad es case-insensitive). No recorta caracteres internos.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** ¿Es un email con forma válida? */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/**
 * Valida un username YA normalizado (minúsculas, sin espacios al borde).
 * Devuelve null si es válido, o un mensaje de error concreto.
 */
export function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `El nombre de usuario debe tener entre ${USERNAME_MIN} y ${USERNAME_MAX} caracteres.`;
  }
  if (!USERNAME_RE.test(username)) {
    return "El nombre de usuario solo admite letras, números, guion y guion bajo.";
  }
  return null;
}

/** Valida una contraseña. Devuelve null si es válida, o un mensaje de error. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  }
  return null;
}

/** ¿El identificador de login parece un email (contiene @)? */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}
