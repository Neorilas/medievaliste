// ============================================================================
// resolveSettlement.ts — el motor de cálculo diferido. EL CORAZÓN del juego.
//
// El servidor no corre procesos de fondo: toda la producción y el consumo se
// calculan BAJO DEMANDA comparando timestamps (now vs lastTick).
//
// Este archivo tiene dos capas:
//   - `simulate(...)`: función PURA y determinista (sin Prisma, sin Date.now()).
//      Toda la lógica de juego vive aquí. Es lo que se testea a fondo.
//   - `resolveSettlement(...)`: wrapper que carga el estado de la DB, llama a
//      `simulate`, persiste el resultado y los eventos. Es la frontera de E/S.
// ============================================================================

import {
  CONSUMPTION,
  FAMINE,
  PLAGUE,
  POPULATION,
  productionPerHour,
  populationCapacity,
  storageCap,
  WELFARE_MAX,
  WELFARE_MIN,
} from "./gameConfig";
import { BuildingType, EventType } from "./generated/prisma/enums";
import type { Prisma } from "./generated/prisma/client";

// Paso de simulación. Pequeño para que los bucles de realimentación (bienestar,
// hambre, crecimiento, pérdida) se resuelvan con la configuración correcta en
// cada tramo: la producción cambia cuando cambia la población.
const STEP_HOURS = 1;

// Tope de seguridad: aunque el jugador no entre durante años, no iteramos sin fin.
const MAX_RESOLVE_HOURS = 365 * 24;

const MS_PER_HOUR = 1000 * 60 * 60;

// ----------------------------------------------------------------------------
// Tipos del motor (independientes de Prisma para poder testear sin DB).
// ----------------------------------------------------------------------------
export interface SimBuilding {
  type: BuildingType;
  level: number;
  workers: number;
}

export interface SimSettlement {
  townHallLevel: number;
  food: number;
  wood: number;
  stone: number;
  welfare: number;
  population: number;
  growthProgress: number;
  famineProgress: number;
  buildings: SimBuilding[];
}

/** Una plaga activa: drena bienestar hasta `until`. */
export interface ActivePlague {
  until: Date;
}

export interface NewEvent {
  type: EventType;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface ResolveSummary {
  elapsedHours: number;
  food: number; // delta neto de comida
  wood: number;
  stone: number;
  welfare: number; // delta neto de bienestar
  populationDelta: number;
  colonistsArrived: number;
  colonistsLost: number;
  plagueActive: boolean;
}

export interface SimResult {
  state: SimSettlement;
  newEvents: NewEvent[];
  summary: ResolveSummary;
}

// ----------------------------------------------------------------------------
// Helpers de estado
// ----------------------------------------------------------------------------

/** Nivel del mejor almacén (0 si no hay ninguno). */
function bestWarehouseLevel(buildings: SimBuilding[]): number {
  let best = 0;
  for (const b of buildings) {
    if (b.type === BuildingType.WAREHOUSE && b.level > best) best = b.level;
  }
  return best;
}

/** Número de casas construidas. */
function houseCount(buildings: SimBuilding[]): number {
  return buildings.filter((b) => b.type === BuildingType.HOUSE).length;
}

/** Producción/hora agregada de un recurso concreto, sumando todos los edificios. */
function ratePerHour(buildings: SimBuilding[], resource: "food" | "wood" | "stone" | "welfare"): number {
  const typeForResource: Record<typeof resource, BuildingType> = {
    food: BuildingType.FARM,
    wood: BuildingType.SAWMILL,
    stone: BuildingType.QUARRY,
    welfare: BuildingType.PLAZA,
  };
  const wanted = typeForResource[resource];
  let total = 0;
  for (const b of buildings) {
    if (b.type === wanted) total += productionPerHour(b.type, b.level, b.workers);
  }
  return total;
}

/** Si hay más colonos asignados que población, retira el exceso de los edificios. */
function clampWorkersToPopulation(state: SimSettlement): void {
  const assigned = state.buildings.reduce((s, b) => s + b.workers, 0);
  if (assigned <= state.population) return;
  let excess = assigned - state.population;
  // Retira de los edificios en orden hasta cuadrar.
  for (const b of state.buildings) {
    if (excess <= 0) break;
    const take = Math.min(b.workers, excess);
    b.workers -= take;
    excess -= take;
  }
}

/** ¿Hay alguna plaga activa en el instante `at`? */
function plagueActiveAt(plagues: ActivePlague[], at: Date): boolean {
  return plagues.some((p) => p.until.getTime() > at.getTime());
}

// ----------------------------------------------------------------------------
// simulate — función PURA. No toca DB, no llama a Date.now().
// ----------------------------------------------------------------------------
export function simulate(
  input: SimSettlement,
  lastTick: Date,
  now: Date,
  activePlagues: ActivePlague[] = [],
): SimResult {
  // Copia profunda del estado para no mutar la entrada.
  const state: SimSettlement = {
    ...input,
    buildings: input.buildings.map((b) => ({ ...b })),
  };

  const newEvents: NewEvent[] = [];
  let colonistsArrived = 0;
  let colonistsLost = 0;

  const start = {
    food: state.food,
    wood: state.wood,
    stone: state.stone,
    welfare: state.welfare,
    population: state.population,
  };

  let elapsedMs = now.getTime() - lastTick.getTime();
  if (elapsedMs < 0) elapsedMs = 0; // reloj hacia atrás: no retrocedemos el estado
  let remainingHours = Math.min(elapsedMs / MS_PER_HOUR, MAX_RESOLVE_HOURS);
  const elapsedHours = remainingHours;

  // Garantiza coherencia inicial (por si llega estado con exceso de trabajadores).
  clampWorkersToPopulation(state);

  let plagueSeen = false;
  let cursor = lastTick.getTime();

  while (remainingHours > 1e-9) {
    const h = Math.min(STEP_HOURS, remainingHours);
    const cap = storageCap(bestWarehouseLevel(state.buildings));
    const plagueOn = plagueActiveAt(activePlagues, new Date(cursor));
    if (plagueOn) plagueSeen = true;

    // --- Recursos acumulables: producir (con tope) ---
    const foodRate = ratePerHour(state.buildings, "food");
    const woodRate = ratePerHour(state.buildings, "wood");
    const stoneRate = ratePerHour(state.buildings, "stone");

    state.food = Math.min(cap, state.food + foodRate * h);
    state.wood = Math.min(cap, state.wood + woodRate * h);
    state.stone = Math.min(cap, state.stone + stoneRate * h);

    // --- Consumo de comida ---
    const foodConsumed = state.population * CONSUMPTION.foodPerColonistPerHour * h;
    state.food -= foodConsumed;
    let starving = false;
    if (state.food < 0) {
      starving = true; // la comida no llegó: hambre este tramo
      state.food = 0;
    }

    // --- Bienestar ---
    const plazaWelfare = ratePerHour(state.buildings, "welfare");
    const baseDrain = state.population * CONSUMPTION.welfareDrainPerColonistPerHour;
    const plagueDrain = plagueOn ? PLAGUE.welfareDrainPerHour : 0;
    const starvationPenalty = starving ? CONSUMPTION.welfareStarvationPenaltyPerHour : 0;
    const welfareDelta = (plazaWelfare - baseDrain - plagueDrain - starvationPenalty) * h;
    state.welfare = Math.max(WELFARE_MIN, Math.min(WELFARE_MAX, state.welfare + welfareDelta));

    // --- Pérdida de población por hambruna (§5) ---
    // Mientras bienestar > umbral, NADIE se pierde y el progreso de crisis se borra.
    if (state.welfare < FAMINE.welfareThreshold) {
      state.famineProgress += h;
      while (state.famineProgress >= FAMINE.hoursPerLoss && state.population > 0) {
        state.population -= 1;
        state.famineProgress -= FAMINE.hoursPerLoss;
        colonistsLost += 1;
        clampWorkersToPopulation(state);
        newEvents.push({
          type: EventType.FAMINE,
          payload: { welfare: Math.round(state.welfare), population: state.population },
          occurredAt: new Date(cursor + h * MS_PER_HOUR),
        });
      }
    } else {
      state.famineProgress = 0;
    }

    // --- Crecimiento de población (§4) ---
    // Solo cuenta tiempo ELEGIBLE: vivienda libre Y superávit de comida Y bienestar alto.
    const capacity = populationCapacity(houseCount(state.buildings));
    const hasRoom = state.population < capacity;
    const foodSurplus = foodRate > state.population * CONSUMPTION.foodPerColonistPerHour;
    const welfareOk = state.welfare > POPULATION.growthWelfareThreshold;
    if (hasRoom && foodSurplus && welfareOk) {
      state.growthProgress += h;
      while (state.growthProgress >= POPULATION.hoursPerColonist && state.population < capacity) {
        state.population += 1;
        state.growthProgress -= POPULATION.hoursPerColonist;
        colonistsArrived += 1;
        newEvents.push({
          type: EventType.COLONIST_ARRIVED,
          payload: { population: state.population },
          occurredAt: new Date(cursor + h * MS_PER_HOUR),
        });
      }
    }
    // Si no es elegible, el progreso se PAUSA (no se reinicia): representa horas elegibles.

    remainingHours -= h;
    cursor += h * MS_PER_HOUR;
  }

  const summary: ResolveSummary = {
    elapsedHours,
    food: state.food - start.food,
    wood: state.wood - start.wood,
    stone: state.stone - start.stone,
    welfare: state.welfare - start.welfare,
    populationDelta: state.population - start.population,
    colonistsArrived,
    colonistsLost,
    plagueActive: plagueSeen,
  };

  return { state, newEvents, summary };
}

// ----------------------------------------------------------------------------
// resolveSettlement — wrapper de E/S. Carga de la DB, simula, persiste.
// Llamar SIEMPRE antes de aplicar cualquier acción del jugador (cierra el tramo
// de producción con la configuración anterior antes de cambiarla).
// ----------------------------------------------------------------------------

export interface ResolvedSettlement {
  summary: ResolveSummary;
  newEvents: NewEvent[];
}

/**
 * Recalcula el estado diferido DENTRO de una transacción ya abierta y lo persiste.
 * Lo usan tanto `resolveSettlement` como el aplicador de acciones, para que
 * "cerrar el tramo" y "aplicar el cambio" ocurran de forma atómica.
 */
export async function resolveWithinTx(
  tx: Prisma.TransactionClient,
  settlementId: string,
  now: Date = new Date(),
): Promise<ResolvedSettlement> {
  const settlement = await tx.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    include: { buildings: true },
  });

  // Plagas activas: eventos PLAGUE cuyo payload.until aún no ha pasado.
  const plagueEvents = await tx.event.findMany({
    where: { settlementId, type: EventType.PLAGUE },
  });
  const activePlagues: ActivePlague[] = plagueEvents
    .map((e) => {
      const until = (e.payload as { until?: string } | null)?.until;
      return until ? { until: new Date(until) } : null;
    })
    .filter((p): p is ActivePlague => p !== null && p.until.getTime() > now.getTime());

  const simBuildings: SimBuilding[] = settlement.buildings.map((b) => ({
    type: b.type,
    level: b.level,
    workers: b.workers,
  }));

  const input: SimSettlement = {
    townHallLevel: settlement.townHallLevel,
    food: settlement.food,
    wood: settlement.wood,
    stone: settlement.stone,
    welfare: settlement.welfare,
    population: settlement.population,
    growthProgress: settlement.growthProgress,
    famineProgress: settlement.famineProgress,
    buildings: simBuildings,
  };

  const { state, newEvents, summary } = simulate(input, settlement.lastTick, now, activePlagues);

  await tx.settlement.update({
    where: { id: settlementId },
    data: {
      food: state.food,
      wood: state.wood,
      stone: state.stone,
      welfare: state.welfare,
      population: state.population,
      growthProgress: state.growthProgress,
      famineProgress: state.famineProgress,
      lastTick: now,
    },
  });

  // Persistir cambios de trabajadores (la hambruna puede haber retirado colonos).
  for (let i = 0; i < settlement.buildings.length; i++) {
    const dbBuilding = settlement.buildings[i];
    const simBuilding = state.buildings[i];
    if (simBuilding && simBuilding.workers !== dbBuilding.workers) {
      await tx.building.update({
        where: { id: dbBuilding.id },
        data: { workers: simBuilding.workers },
      });
    }
  }

  if (newEvents.length > 0) {
    await tx.event.createMany({
      data: newEvents.map((e) => ({
        settlementId,
        type: e.type,
        payload: e.payload as object,
        occurredAt: e.occurredAt,
      })),
    });
  }

  return { summary, newEvents };
}

/**
 * Recalcula el estado diferido de un asentamiento y lo persiste, en su propia
 * transacción. Llamar al abrir la app (GET /api/settlement).
 */
export async function resolveSettlement(settlementId: string): Promise<ResolvedSettlement> {
  const now = new Date();
  // Import diferido: mantiene `simulate` puro y testeable sin tocar la DB.
  const { prisma } = await import("./prisma");
  return prisma.$transaction((tx) => resolveWithinTx(tx, settlementId, now));
}
