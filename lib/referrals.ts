// ============================================================================
// referrals.ts — sistema de referidos (Bloque 3).
//
// Cada usuario tiene un `referralCode` único y un enlace /join?ref=CODE. Cuando un
// amigo se registra con ese enlace, se guarda `referredById` y recibe un bonus de
// bienvenida. Cuando ese amigo llega a Ayuntamiento N2, el referidor recibe la
// recompensa (una sola vez, controlada por `referralRewardAt` del referido).
// ============================================================================

import type { Prisma } from "./generated/prisma/client";

// Recompensa de referido (igual para el bonus de bienvenida y para el referidor).
export const REFERRAL_REWARD = { wood: 25, food: 25, stone: 25 } as const;

// Nivel de Ayuntamiento que activa la recompensa al referidor.
export const REFERRAL_ACTIVATION_TOWNHALL_LEVEL = 2;

/** Enlace de invitación completo a partir del código. */
export function referralLink(code: string): string {
  const base = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const origin = base.replace(/\/$/, "");
  return `${origin}/join?ref=${encodeURIComponent(code)}`;
}

/**
 * Si el dueño de `settlement` fue referido y ya alcanzó el Ayuntamiento de
 * activación, entrega la recompensa al referidor (una sola vez) DENTRO de la
 * transacción abierta. Devuelve true si se activó en esta llamada.
 *
 * Se llama tras recalcular el estado (el nivel del Ayuntamiento sube cuando la
 * obra se completa en el motor diferido, no al encargarla).
 */
export async function maybeActivateReferral(
  tx: Prisma.TransactionClient,
  settlement: { userId: string; townHallLevel: number },
): Promise<boolean> {
  if (settlement.townHallLevel < REFERRAL_ACTIVATION_TOWNHALL_LEVEL) return false;

  const user = await tx.user.findUnique({
    where: { id: settlement.userId },
    select: { referredById: true, referralRewardAt: true },
  });
  if (!user?.referredById || user.referralRewardAt) return false;

  // Marca la recompensa como entregada de forma atómica: solo procede si seguía
  // sin entregar (guard contra dobles activaciones por llamadas concurrentes).
  const marked = await tx.user.updateMany({
    where: { id: settlement.userId, referralRewardAt: null },
    data: { referralRewardAt: new Date() },
  });
  if (marked.count === 0) return false;

  // Entrega la recompensa al settlement del referidor (si lo tiene creado).
  await tx.settlement.updateMany({
    where: { userId: user.referredById },
    data: {
      wood: { increment: REFERRAL_REWARD.wood },
      food: { increment: REFERRAL_REWARD.food },
      stone: { increment: REFERRAL_REWARD.stone },
    },
  });

  return true;
}
