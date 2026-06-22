// ============================================================================
// achievements.ts — sistema de Hazañas (Bloque 3).
//
// Igual que gameConfig, las DEFINICIONES de hazañas viven en código, NO en la BD.
// La BD solo guarda qué hazañas ha completado cada usuario (UserAchievement).
//
// Dos tipos de hazaña:
//   - Encadenadas: comparten `chainId` y tienen `chainOrder`. Solo se evalúa la
//     siguiente NO completada de cada cadena; las posteriores quedan "bloqueadas".
//   - Sueltas: `chainId === null`. Independientes, disponibles desde el inicio.
//
// Canje manual (Bloque 5): la DETECCIÓN y la APLICACIÓN de recompensas están
// separadas. `evaluateAchievements` solo DETECTA (marca completadas con
// completedAt) tras cada cambio de estado; NO toca los recursos. La recompensa se
// aplica únicamente cuando el jugador reclama manualmente (POST /api/achievements/
// claim/:id → `claimAchievement`).
// ============================================================================

import { BuildingType } from "./generated/prisma/enums";
import type { Prisma } from "./generated/prisma/client";

// Tipos de condición. El valor actual de cada uno se calcula en `currentValues`.
export type ConditionType =
  | "total_wood_produced"
  | "total_food_produced"
  | "total_stone_produced"
  | "buildings_built"
  | "townhall_level"
  | "colonists_total"
  | "colonists_assigned"
  | "warehouse_upgraded";

// Una hazaña puede entregar varios recursos a la vez (el plan lista recompensas
// combinadas como "100 comida + 1 colono"), de ahí el objeto en vez de un par
// rewardType/rewardAmount.
export interface Reward {
  wood?: number;
  food?: number;
  stone?: number;
  colonist?: number;
}

export interface AchievementDef {
  id: string;
  chainId: string | null; // null = hazaña suelta
  chainOrder: number | null; // posición dentro de la cadena (1, 2, 3…)
  title: string;
  description: string;
  conditionType: ConditionType;
  conditionValue: number;
  reward: Reward;
}

// ----------------------------------------------------------------------------
// Definiciones de hazañas. AÑADIR aquí hazañas nuevas (no tocar la BD).
// ----------------------------------------------------------------------------
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // --- Cadena: El camino de la madera ---
  {
    id: "wood_1",
    chainId: "wood",
    chainOrder: 1,
    title: "Primer hacha",
    description: "Produce 100 de madera",
    conditionType: "total_wood_produced",
    conditionValue: 100,
    reward: { food: 50 },
  },
  {
    id: "wood_2",
    chainId: "wood",
    chainOrder: 2,
    title: "Leñador constante",
    description: "Produce 500 de madera",
    conditionType: "total_wood_produced",
    conditionValue: 500,
    reward: { food: 100, colonist: 1 },
  },
  {
    id: "wood_3",
    chainId: "wood",
    chainOrder: 3,
    title: "Bosque talado",
    description: "Produce 2000 de madera",
    conditionType: "total_wood_produced",
    conditionValue: 2000,
    reward: { wood: 200, colonist: 1 },
  },

  // --- Cadena: Crecimiento de la colonia ---
  {
    id: "pop_1",
    chainId: "pop",
    chainOrder: 1,
    title: "Primeros vecinos",
    description: "Llega a 5 colonos",
    conditionType: "colonists_total",
    conditionValue: 5,
    reward: { wood: 100 },
  },
  {
    id: "pop_2",
    chainId: "pop",
    chainOrder: 2,
    title: "Una aldea",
    description: "Llega a 10 colonos",
    conditionType: "colonists_total",
    conditionValue: 10,
    reward: { wood: 150, food: 100 },
  },
  {
    id: "pop_3",
    chainId: "pop",
    chainOrder: 3,
    title: "Una ciudad en ciernes",
    description: "Llega a 20 colonos",
    conditionType: "colonists_total",
    conditionValue: 20,
    reward: { stone: 200, colonist: 2 },
  },

  // --- Cadena: Expansión del asentamiento ---
  {
    id: "build_1",
    chainId: "build",
    chainOrder: 1,
    title: "Constructor novato",
    description: "Construye 3 edificios",
    conditionType: "buildings_built",
    conditionValue: 3,
    reward: { wood: 50 },
  },
  {
    id: "build_2",
    chainId: "build",
    chainOrder: 2,
    title: "Maestro de obras",
    description: "Construye 6 edificios",
    conditionType: "buildings_built",
    conditionValue: 6,
    reward: { stone: 100 },
  },
  {
    id: "build_3",
    chainId: "build",
    chainOrder: 3,
    title: "Arquitecto del Imperio",
    description: "Construye 10 edificios",
    conditionType: "buildings_built",
    conditionValue: 10,
    reward: { stone: 150, colonist: 1 },
  },

  // --- Hazañas sueltas ---
  {
    id: "townhall_2",
    chainId: null,
    chainOrder: null,
    title: "Autoridad provincial",
    description: "Sube el Ayuntamiento a nivel 2",
    conditionType: "townhall_level",
    conditionValue: 2,
    reward: { colonist: 1 },
  },
  {
    id: "townhall_3",
    chainId: null,
    chainOrder: null,
    title: "Sede del poder",
    description: "Sube el Ayuntamiento a nivel 3",
    conditionType: "townhall_level",
    conditionValue: 3,
    reward: { colonist: 2 },
  },
  {
    id: "warehouse_2",
    chainId: null,
    chainOrder: null,
    title: "Despensa ampliada",
    description: "Sube el almacén a nivel 2",
    conditionType: "warehouse_upgraded",
    conditionValue: 2,
    reward: { food: 100 },
  },
  {
    id: "all_assigned",
    chainId: null,
    chainOrder: null,
    title: "Nadie descansa",
    description: "Ten 10 colonos asignados a la vez",
    conditionType: "colonists_assigned",
    conditionValue: 10,
    reward: { wood: 100, food: 100 },
  },
  {
    id: "stone_first",
    chainId: null,
    chainOrder: null,
    title: "Cantero",
    description: "Produce 200 de piedra",
    conditionType: "total_stone_produced",
    conditionValue: 200,
    reward: { wood: 100 },
  },
];

const ACHIEVEMENTS_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS_BY_ID.get(id);
}

// ----------------------------------------------------------------------------
// Estado actual del asentamiento para cada tipo de condición.
// ----------------------------------------------------------------------------
export interface AchievementState {
  total_wood_produced: number;
  total_food_produced: number;
  total_stone_produced: number;
  buildings_built: number;
  townhall_level: number;
  colonists_total: number;
  colonists_assigned: number;
  warehouse_upgraded: number;
}

interface SettlementForState {
  townHallLevel: number;
  population: number;
  totalFoodProduced: number;
  totalWoodProduced: number;
  totalStoneProduced: number;
  buildings: { type: BuildingType; level: number; workers: number }[];
}

/** Calcula el valor actual de cada condición a partir del estado del asentamiento. */
export function currentValues(s: SettlementForState): AchievementState {
  // "Construidos" = edificios terminados (level >= 1) que no son el Ayuntamiento.
  const buildingsBuilt = s.buildings.filter(
    (b) => b.type !== BuildingType.TOWN_HALL && b.level >= 1,
  ).length;
  const assigned = s.buildings.reduce((a, b) => a + b.workers, 0);
  const bestWarehouse = s.buildings
    .filter((b) => b.type === BuildingType.WAREHOUSE)
    .reduce((m, b) => Math.max(m, b.level), 0);

  return {
    total_wood_produced: s.totalWoodProduced,
    total_food_produced: s.totalFoodProduced,
    total_stone_produced: s.totalStoneProduced,
    buildings_built: buildingsBuilt,
    townhall_level: s.townHallLevel,
    colonists_total: s.population,
    colonists_assigned: assigned,
    warehouse_upgraded: bestWarehouse,
  };
}

// ----------------------------------------------------------------------------
// Categorización para la UI (GET /api/achievements).
// ----------------------------------------------------------------------------
export interface AchievementProgress {
  def: AchievementDef;
  current: number;
  target: number;
  completedAt: string | null;
  // null mientras esté pendiente de canje; fecha una vez reclamada la recompensa.
  claimedAt: string | null;
}

// Estado de completitud guardado en BD para cada hazaña del usuario.
export interface CompletionRecord {
  completedAt: Date;
  claimedAt: Date | null;
}

export interface CategorizedAchievements {
  completed: AchievementProgress[];
  available: AchievementProgress[];
  // Bloqueadas: solo se expone existencia (id + título), sin condición ni recompensa.
  locked: { id: string; title: string; chainId: string | null }[];
}

/**
 * Reparte todas las hazañas en completadas / disponibles / bloqueadas según las ya
 * completadas y el estado actual. Para cadenas: la siguiente no completada está
 * "disponible" y el resto "bloqueadas". Las sueltas nunca se bloquean.
 */
export function categorizeAchievements(
  completedMap: Map<string, CompletionRecord>,
  values: AchievementState,
): CategorizedAchievements {
  const completed: AchievementProgress[] = [];
  const available: AchievementProgress[] = [];
  const locked: { id: string; title: string; chainId: string | null }[] = [];

  const progress = (def: AchievementDef): AchievementProgress => {
    const rec = completedMap.get(def.id);
    return {
      def,
      current: Math.floor(values[def.conditionType]),
      target: def.conditionValue,
      completedAt: rec?.completedAt.toISOString() ?? null,
      claimedAt: rec?.claimedAt?.toISOString() ?? null,
    };
  };

  // Sueltas.
  for (const def of ACHIEVEMENTS.filter((a) => a.chainId === null)) {
    if (completedMap.has(def.id)) completed.push(progress(def));
    else available.push(progress(def));
  }

  // Cadenas: agrupar y ordenar por chainOrder.
  const chains = new Map<string, AchievementDef[]>();
  for (const def of ACHIEVEMENTS) {
    if (def.chainId === null) continue;
    const arr = chains.get(def.chainId) ?? [];
    arr.push(def);
    chains.set(def.chainId, arr);
  }
  for (const arr of chains.values()) {
    arr.sort((a, b) => (a.chainOrder ?? 0) - (b.chainOrder ?? 0));
    let nextShown = false; // ¿ya marcamos la "siguiente" como disponible?
    for (const def of arr) {
      if (completedMap.has(def.id)) {
        completed.push(progress(def));
      } else if (!nextShown) {
        available.push(progress(def)); // la primera no completada está disponible
        nextShown = true;
      } else {
        locked.push({ id: def.id, title: def.title, chainId: def.chainId });
      }
    }
  }

  return { completed, available, locked };
}

// ----------------------------------------------------------------------------
// Detección: comprueba condiciones y persiste completados. NO entrega recompensas
// (eso ocurre al reclamar, ver `claimAchievement`).
// ----------------------------------------------------------------------------
export interface CompletedAchievement {
  id: string;
  title: string;
  description: string;
  reward: Reward;
}

/** Hazañas candidatas a evaluar: siguiente no completada de cada cadena + sueltas. */
function candidates(completedIds: Set<string>): AchievementDef[] {
  const out: AchievementDef[] = [];
  // Sueltas no completadas.
  for (const def of ACHIEVEMENTS) {
    if (def.chainId === null && !completedIds.has(def.id)) out.push(def);
  }
  // Siguiente no completada de cada cadena.
  const chains = new Map<string, AchievementDef[]>();
  for (const def of ACHIEVEMENTS) {
    if (def.chainId === null) continue;
    const arr = chains.get(def.chainId) ?? [];
    arr.push(def);
    chains.set(def.chainId, arr);
  }
  for (const arr of chains.values()) {
    arr.sort((a, b) => (a.chainOrder ?? 0) - (b.chainOrder ?? 0));
    const next = arr.find((d) => !completedIds.has(d.id));
    if (next) out.push(next);
  }
  return out;
}

/**
 * DETECTA las hazañas recién completadas por el usuario dueño de `settlementId`
 * DENTRO de una transacción abierta, sobre el estado ya actualizado. Persiste los
 * UserAchievement (sin claimedAt: quedan pendientes de canje) y devuelve las
 * completadas en esta evaluación (para la UI). NO entrega recompensas: eso ocurre
 * al reclamar manualmente (`claimAchievement`).
 *
 * Debe llamarse SIEMPRE con el estado fresco (después de aplicar el cambio que la
 * dispara), para no evaluar sobre estado obsoleto.
 */
export async function evaluateAchievements(
  tx: Prisma.TransactionClient,
  settlementId: string,
): Promise<CompletedAchievement[]> {
  const settlement = await tx.settlement.findUnique({
    where: { id: settlementId },
    include: { buildings: true },
  });
  if (!settlement) return [];

  const userId = settlement.userId;
  const done = await tx.userAchievement.findMany({
    where: { userId },
    select: { achievementId: true },
  });
  const completedIds = new Set(done.map((d) => d.achievementId));

  const values = currentValues(settlement);
  const newlyCompleted: CompletedAchievement[] = [];

  // Bucle de punto fijo: completar una hazaña de cadena habilita evaluar la
  // siguiente de esa cadena en la misma pasada (p. ej. si se produjo madera de
  // sobra estando offline, se detectan wood_1 y wood_2 a la vez). Las recompensas
  // ya no se aplican aquí, así que no hay cascada por colonos.
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of candidates(completedIds)) {
      if (completedIds.has(def.id)) continue;
      if (values[def.conditionType] < def.conditionValue) continue;

      // Se cumple: registrar completado, pendiente de canje (claimedAt = null).
      // La unicidad protege de duplicados.
      await tx.userAchievement.create({
        data: { userId, achievementId: def.id },
      });
      completedIds.add(def.id);
      newlyCompleted.push({
        id: def.id,
        title: def.title,
        description: def.description,
        reward: def.reward,
      });

      changed = true;
    }
  }

  return newlyCompleted;
}

/** Nº de hazañas completadas pendientes de canje (para el badge de navegación). */
export async function countPendingClaims(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  return tx.userAchievement.count({ where: { userId, claimedAt: null } });
}

// Errores tipados de `claimAchievement`, para que el endpoint los mapee a 404/409.
export type ClaimErrorReason = "not_found" | "already_claimed";
export class ClaimError extends Error {
  constructor(public reason: ClaimErrorReason) {
    super(reason);
  }
}

/**
 * Reclama (canjea) la recompensa de una hazaña completada del usuario, en su propia
 * transacción: aplica los recursos al settlement y escribe claimedAt. Idempotente
 * frente a dobles clics gracias a un update condicional sobre claimedAt == null.
 *
 * Lanza ClaimError("not_found") si la hazaña no existe o no es del usuario, y
 * ClaimError("already_claimed") si ya fue reclamada.
 */
export async function claimAchievement(
  userId: string,
  achievementId: string,
): Promise<Reward> {
  const { prisma } = await import("./prisma");
  return prisma.$transaction(async (tx) => {
    const ua = await tx.userAchievement.findUnique({
      where: { id: achievementId },
      select: { id: true, userId: true, achievementId: true, claimedAt: true },
    });
    if (!ua || ua.userId !== userId) throw new ClaimError("not_found");
    if (ua.claimedAt !== null) throw new ClaimError("already_claimed");

    const def = getAchievement(ua.achievementId);
    // Definición retirada del código: nada que entregar, pero cerramos el claim.
    const reward: Reward = def?.reward ?? {};

    // Marca como reclamada de forma condicional para evitar dobles entregas en una
    // carrera (dos peticiones simultáneas): solo una verá count === 1.
    const marked = await tx.userAchievement.updateMany({
      where: { id: ua.id, claimedAt: null },
      data: { claimedAt: new Date() },
    });
    if (marked.count === 0) throw new ClaimError("already_claimed");

    const settlement = await tx.settlement.findUniqueOrThrow({
      where: { userId },
      select: { id: true },
    });
    await tx.settlement.update({
      where: { id: settlement.id },
      data: {
        wood: { increment: reward.wood ?? 0 },
        food: { increment: reward.food ?? 0 },
        stone: { increment: reward.stone ?? 0 },
        population: { increment: reward.colonist ?? 0 },
      },
    });

    return reward;
  });
}
