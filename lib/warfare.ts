// ============================================================================
// warfare.ts — conquista, vasallaje y rebelión (Bloque 6, §1).
//
// La guerra es ASÍNCRONA y se resuelve INMEDIATAMENTE por stats: no hay ventana de
// negociación ni combate táctico (decisión cerrada §7). El bando con más fuerza
// militar gana; en empate gana el defensor.
//
// Antes de medir fuerzas se cierra el tramo diferido de AMBOS bandos
// (resolveWithinTx), igual que cualquier acción del jugador (§7): así las fuerzas
// reflejan los recursos al instante de la guerra. Toda la operación es atómica.
// ============================================================================

import { resolveWithinTx } from "./resolveSettlement";
import { militaryForce, MILITARY } from "./gameConfig";
import { EventType } from "./generated/prisma/enums";
import type { Prisma } from "./generated/prisma/client";

export class WarfareError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Consecuencia concreta de una guerra, para mostrar al jugador. */
export type WarOutcome =
  | "conquered" // el atacante venció y tomó al defensor como vasallo
  | "defended" // el defensor repelió el ataque (nada cambia)
  | "freed" // rebelión victoriosa: el vasallo quedó libre
  | "rebellion_failed"; // rebelión fallida: el vasallo sigue siéndolo

export interface WarResult {
  attackerName: string;
  defenderName: string;
  attackerForce: number;
  defenderForce: number;
  attackerWon: boolean;
  isRebellion: boolean;
  outcome: WarOutcome;
}

// Datos mínimos de un bando, ya con su tramo cerrado y su fuerza calculada.
interface Combatant {
  id: string;
  name: string;
  region: string | null;
  createdAt: Date;
  overlordLordId: string | null; // señor actual (si es vasallo)
  force: number;
}

/** ¿Sigue el asentamiento bajo la inmunidad de novato? (§1.6) */
function isImmune(createdAt: Date, now: Date): boolean {
  const until = createdAt.getTime() + MILITARY.newbieImmunityDays * 24 * 60 * 60 * 1000;
  return now.getTime() < until;
}

/** Carga un bando (con su tramo ya cerrado) y calcula su fuerza militar actual. */
async function loadCombatant(
  tx: Prisma.TransactionClient,
  settlementId: string,
): Promise<Combatant> {
  const s = await tx.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    include: { buildings: true, overlord: true },
  });
  return {
    id: s.id,
    name: s.name,
    region: s.region,
    createdAt: s.createdAt,
    overlordLordId: s.overlord?.lordId ?? null,
    force: militaryForce({
      buildings: s.buildings,
      food: s.food,
      wood: s.wood,
      stone: s.stone,
    }),
  };
}

/** ¿El mismo agresor ya atacó a este defensor dentro de la ventana de cooldown? (§1.6) */
async function onCooldown(
  tx: Prisma.TransactionClient,
  attackerId: string,
  defenderId: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - MILITARY.attackCooldownHours * 60 * 60 * 1000);
  const recent = await tx.warDeclaration.findFirst({
    where: { attackerId, defenderId, declaredAt: { gte: since } },
    select: { id: true },
  });
  return recent !== null;
}

/**
 * Resuelve la batalla entre dos combatientes ya cargados, aplica las consecuencias
 * (vasallaje/liberación) y registra la declaración y los eventos. Núcleo común de
 * declareWar y declareRebellion.
 */
async function resolveBattle(
  tx: Prisma.TransactionClient,
  attacker: Combatant,
  defender: Combatant,
  isRebellion: boolean,
  now: Date,
): Promise<WarResult> {
  // El atacante necesita fuerza ESTRICTAMENTE mayor: en empate gana el defensor (§1.2).
  const attackerWon = attacker.force > defender.force;
  const winnerId = attackerWon ? attacker.id : defender.id;

  let outcome: WarOutcome;

  if (isRebellion) {
    if (attackerWon) {
      // Rebelión victoriosa: el vasallo (atacante) queda libre (§1.5).
      await tx.vassalage.deleteMany({ where: { vassalId: attacker.id } });
      outcome = "freed";
    } else {
      // Sin penalización adicional en v1: sigue siendo vasallo.
      outcome = "rebellion_failed";
    }
  } else if (attackerWon) {
    // Conquista (§1.3): el defensor pasa a ser vasallo del atacante.
    // Cascada de liberación (§1.6): si el defensor era SEÑOR, sus vasallos se liberan
    // (jerarquía plana: un vasallo no puede tener vasallos).
    await tx.vassalage.deleteMany({ where: { lordId: defender.id } });
    // Si el defensor ya era vasallo de otro, su antiguo señor lo pierde.
    await tx.vassalage.deleteMany({ where: { vassalId: defender.id } });
    await tx.vassalage.create({
      data: {
        lordId: attacker.id,
        vassalId: defender.id,
        tributePct: MILITARY.vassalTributePct,
      },
    });
    outcome = "conquered";
  } else {
    outcome = "defended";
  }

  await tx.warDeclaration.create({
    data: {
      attackerId: attacker.id,
      defenderId: defender.id,
      declaredAt: now,
      resolvedAt: now,
      winnerId,
      attackerForce: attacker.force,
      defenderForce: defender.force,
      isRebellion,
    },
  });

  // Log interno para ambos bandos (historial; el detalle va en el payload).
  const payload = {
    attackerName: attacker.name,
    defenderName: defender.name,
    attackerForce: attacker.force,
    defenderForce: defender.force,
    isRebellion,
    outcome,
  };
  await tx.event.createMany({
    data: [
      { settlementId: attacker.id, type: EventType.WAR_ATTACK, payload, occurredAt: now },
      { settlementId: defender.id, type: EventType.WAR_DEFENSE, payload, occurredAt: now },
    ],
  });

  return {
    attackerName: attacker.name,
    defenderName: defender.name,
    attackerForce: attacker.force,
    defenderForce: defender.force,
    attackerWon,
    isRebellion,
    outcome,
  };
}

/**
 * Declara guerra de `attackerId` contra `defenderId` y la resuelve al instante.
 * Valida región, libertad del atacante, inmunidad de novato y cooldown (§1.2/§1.6).
 */
export async function declareWar(attackerId: string, defenderId: string): Promise<WarResult> {
  if (attackerId === defenderId) {
    throw new WarfareError("No puedes atacarte a ti mismo.");
  }
  const now = new Date();
  const { prisma } = await import("./prisma");

  return prisma.$transaction(async (tx) => {
    // Cierra el tramo diferido de ambos antes de medir fuerzas (§7).
    await resolveWithinTx(tx, attackerId, now);
    await resolveWithinTx(tx, defenderId, now);

    const attacker = await loadCombatant(tx, attackerId);
    const defender = await loadCombatant(tx, defenderId);

    if (!attacker.region || attacker.region !== defender.region) {
      throw new WarfareError("Solo puedes atacar asentamientos de tu región.");
    }
    // Un vasallo no puede declarar guerra; solo rebelarse contra su señor (§1.5).
    if (attacker.overlordLordId) {
      throw new WarfareError(
        "Eres vasallo: no puedes declarar guerra. Solo puedes rebelarte contra tu señor.",
        409,
      );
    }
    // No tiene sentido atacar a quien ya es tu vasallo.
    if (defender.overlordLordId === attackerId) {
      throw new WarfareError("Ese asentamiento ya es tu vasallo.");
    }
    // Inmunidad de novato del defensor (§1.6).
    if (isImmune(defender.createdAt, now)) {
      throw new WarfareError(
        "Ese asentamiento está protegido por la inmunidad de novato.",
        409,
      );
    }
    // Cooldown de 48h entre el mismo agresor y el mismo defensor (§1.6).
    if (await onCooldown(tx, attackerId, defenderId, now)) {
      throw new WarfareError(
        "Ya atacaste a este asentamiento hace poco. Espera antes de volver a hacerlo.",
        429,
      );
    }

    return resolveBattle(tx, attacker, defender, false, now);
  });
}

/**
 * Un vasallo se rebela contra su señor (§1.5). En v1 la única condición de
 * elegibilidad implementada es que su fuerza supere la del señor (las vías de
 * alianza y de ley del Concilium quedan pendientes de diseño).
 */
export async function declareRebellion(vassalId: string): Promise<WarResult> {
  const now = new Date();
  const { prisma } = await import("./prisma");

  return prisma.$transaction(async (tx) => {
    await resolveWithinTx(tx, vassalId, now);
    const vassal = await loadCombatant(tx, vassalId);
    if (!vassal.overlordLordId) {
      throw new WarfareError("No eres vasallo de nadie: no hay contra quién rebelarse.");
    }
    const lordId = vassal.overlordLordId;
    await resolveWithinTx(tx, lordId, now);
    const lord = await loadCombatant(tx, lordId);

    // Elegibilidad v1 (§1.5): la fuerza del vasallo debe superar la del señor.
    if (vassal.force <= lord.force) {
      throw new WarfareError(
        "Tu fuerza militar aún no supera la de tu señor; no puedes rebelarte.",
        409,
      );
    }

    return resolveBattle(tx, vassal, lord, true, now);
  });
}
