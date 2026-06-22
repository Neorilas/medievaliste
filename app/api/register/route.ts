// POST /api/register — alta con email + nombre de usuario + contraseña.
// Crea el User con su hash y su username (en minúsculas para unicidad).
// El asentamiento se crea en el primer acceso al juego; la región se elige luego
// en el onboarding.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  normalizeEmail,
  normalizeUsername,
  isValidEmail,
  validateUsername,
  validatePassword,
} from "@/lib/accountValidation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? normalizeEmail(b.email) : "";
  const username = typeof b.username === "string" ? normalizeUsername(b.username) : "";
  const password = typeof b.password === "string" ? b.password : "";
  // Código de referido (opcional): viene del enlace /join?ref=CODE.
  const ref = typeof b.ref === "string" ? b.ref.trim() : "";

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Email no válido.", field: "email" }, { status: 400 });
  }
  const usernameError = validateUsername(username);
  if (usernameError) {
    return NextResponse.json({ error: usernameError, field: "username" }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError, field: "password" }, { status: 400 });
  }

  // Unicidad: errores específicos por campo para que la UI los muestre bien.
  const [byEmail, byUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
  ]);
  if (byEmail) {
    return NextResponse.json(
      { error: "Este email ya está registrado.", field: "email" },
      { status: 409 },
    );
  }
  if (byUsername) {
    return NextResponse.json(
      { error: "Este nombre de usuario ya está en uso.", field: "username" },
      { status: 409 },
    );
  }

  // Resolver el referidor por su código, si vino uno válido. Un código inválido o
  // ausente simplemente se ignora (registro orgánico). El bonus de bienvenida se
  // entrega al crear el asentamiento (ver getOrCreateSettlementForUser).
  let referredById: string | null = null;
  if (ref) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: ref },
      select: { id: true },
    });
    if (referrer) referredById = referrer.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.user.create({ data: { email, username, passwordHash, referredById } });
  } catch {
    // Carrera entre la comprobación y el create (índice único): genérico.
    return NextResponse.json(
      { error: "Ese email o nombre de usuario ya está en uso." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
