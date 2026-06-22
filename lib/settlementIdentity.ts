// ============================================================================
// settlementIdentity.ts — renombre del asentamiento (CAMBIO 1) y fijación de la
// región (CAMBIO 3). La región es PERMANENTE: solo se puede fijar una vez.
// ============================================================================

import { SETTLEMENT_NAME } from "./gameConfig";
import { Region } from "./generated/prisma/enums";
import { ensureRegionNeutrals, generatePlayerPosition } from "./neutralSettlements";

export class IdentityError extends Error {
  status: number;
  retryAfterSeconds?: number;
  constructor(message: string, status = 400, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// --- Nombre del asentamiento (validación pura) ---

/** Limpia espacios redundantes de un nombre propuesto. */
export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Valida un nombre de asentamiento. Devuelve null si es válido, o un mensaje.
 * Acepta letras (con acentos), números, espacios y unos pocos signos seguros.
 */
export function validateSettlementName(name: string): string | null {
  if (name.length < SETTLEMENT_NAME.minLength) {
    return `El nombre debe tener al menos ${SETTLEMENT_NAME.minLength} caracteres.`;
  }
  if (name.length > SETTLEMENT_NAME.maxLength) {
    return `El nombre no puede superar los ${SETTLEMENT_NAME.maxLength} caracteres.`;
  }
  // Lista blanca: letras (cualquier alfabeto, con acentos), números, espacio y
  // unos pocos signos seguros. Rechaza < > y caracteres de control de paso.
  if (!/^[\p{L}\p{N} '._-]+$/u.test(name)) {
    return "El nombre contiene caracteres no permitidos.";
  }
  return null;
}

/**
 * Segundos que faltan para poder renombrar, dado el último cambio. 0 = ya puede.
 */
export function renameCooldownRemaining(
  nameChangedAt: Date | null,
  now: Date = new Date(),
): number {
  if (!nameChangedAt) return 0;
  const cooldownMs = SETTLEMENT_NAME.cooldownHours * 3600 * 1000;
  const elapsed = now.getTime() - nameChangedAt.getTime();
  const remaining = cooldownMs - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// --- Operaciones con DB ---

/** Renombra el asentamiento respetando el cooldown. Lanza IdentityError si falla. */
export async function renameSettlement(
  settlementId: string,
  rawName: string,
): Promise<{ name: string; nameChangedAt: Date }> {
  const { prisma } = await import("./prisma");
  const name = sanitizeName(rawName);

  const nameError = validateSettlementName(name);
  if (nameError) throw new IdentityError(nameError, 400);

  const s = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { nameChangedAt: true },
  });

  const now = new Date();
  const remaining = renameCooldownRemaining(s.nameChangedAt, now);
  if (remaining > 0) {
    throw new IdentityError(
      "Solo puedes cambiar el nombre una vez cada 24 horas.",
      429,
      remaining,
    );
  }

  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: { name, nameChangedAt: now },
    select: { name: true, nameChangedAt: true },
  });
  return { name: updated.name, nameChangedAt: updated.nameChangedAt! };
}

/**
 * Fija la región del asentamiento (permanente). Siembra los neutrales de la
 * región y asigna una posición de partida al asentamiento en el tablero.
 * Lanza IdentityError si la región ya estaba fijada.
 */
export async function setSettlementRegion(
  settlementId: string,
  region: Region,
): Promise<void> {
  const { prisma } = await import("./prisma");

  const s = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { region: true },
  });
  if (s.region) {
    throw new IdentityError("Tu región ya está fijada y es permanente.", 409);
  }

  // Asegura los neutrales de la región (idempotente) y coloca al jugador.
  await ensureRegionNeutrals(region);
  const neutrals = await prisma.neutralSettlement.findMany({
    where: { region },
    select: { posX: true, posY: true },
  });
  const pos = generatePlayerPosition(settlementId, neutrals);

  await prisma.settlement.update({
    where: { id: settlementId },
    data: { region, posX: pos.posX, posY: pos.posY },
  });
}
