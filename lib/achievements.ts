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
// Las recompensas se entregan automáticamente al cumplir la condición (no hay
// paso de "reclamar"). `evaluateAchievements` se llama tras cada cambio de estado.
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
  completedMap: Map<string, Date>,
  values: AchievementState,
): CategorizedAchievements {
  const completed: AchievementProgress[] = [];
  const available: AchievementProgress[] = [];
  const locked: { id: string; title: string; chainId: string | null }[] = [];

  const progress = (def: AchievementDef): AchievementProgress => ({
    def,
    current: Math.floor(values[def.conditionType]),
    target: def.conditionValue,
    completedAt: completedMap.get(def.id)?.toISOString() ?? null,
  });

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
// Evaluación: comprueba condiciones, entrega recompensas, persiste completados.
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
 * Evalúa las hazañas del usuario dueño de `settlementId` DENTRO de una transacción
 * abierta, sobre el estado ya actualizado. Entrega recompensas, persiste los
 * UserAchievement y devuelve las hazañas completadas en esta evaluación (para la UI).
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

  // Recompensas acumuladas para aplicar de una sola vez al final.
  const grant: Required<Reward> = { wood: 0, food: 0, stone: 0, colonist: 0 };
  const newlyCompleted: CompletedAchievement[] = [];

  // Bucle de punto fijo: una recompensa de colono puede disparar la siguiente
  // hazaña de población, y completar una de cadena habilita evaluar la siguiente.
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of candidates(completedIds)) {
      if (completedIds.has(def.id)) continue;
      if (values[def.conditionType] < def.conditionValue) continue;

      // Se cumple: registrar completado (la unicidad protege de duplicados).
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

      // Acumular recompensa y reflejar en los valores en memoria (los colonos
      // afectan a colonists_total; el resto de recursos no son condiciones).
      grant.wood += def.reward.wood ?? 0;
      grant.food += def.reward.food ?? 0;
      grant.stone += def.reward.stone ?? 0;
      const colonist = def.reward.colonist ?? 0;
      grant.colonist += colonist;
      if (colonist > 0) values.colonists_total += colonist;

      changed = true;
    }
  }

  if (newlyCompleted.length > 0) {
    await tx.settlement.update({
      where: { id: settlementId },
      data: {
        wood: { increment: grant.wood },
        food: { increment: grant.food },
        stone: { increment: grant.stone },
        population: { increment: grant.colonist },
      },
    });
  }

  return newlyCompleted;
}
