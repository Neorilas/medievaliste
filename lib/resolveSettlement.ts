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
import {
  countPendingClaims,
  evaluateAchievements,
  type CompletedAchievement,
} from "./achievements";
import { maybeActivateReferral } from "./referrals";

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
  // Obra en curso: si no es null/undefined, el edificio sube a `level + 1` en este
  // instante. Nivel 0 = edificio nuevo aún sin terminar (no produce ni cuenta).
  // Opcional para que los estados de prueba sin obras no tengan que declararlo.
  constructionEndsAt?: Date | null;
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
  // ¿Ya llegó el primer colono nuevo por crecimiento? (Cambio A) Mientras es false,
  // el primer colono usa el umbral acelerado `firstColonistHours`; el resto, 24h.
  firstColonistReceived: boolean;
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
  buildingsCompleted: number; // obras (construcciones/mejoras) terminadas en el tramo
  plagueActive: boolean;
  // Producción BRUTA del tramo (antes de consumo y tope de almacén). Alimenta los
  // contadores acumulados del asentamiento para las hazañas total_*_produced.
  producedFood: number;
  producedWood: number;
  producedStone: number;
  // Tributo cedido al señor en el tramo (Bloque 6, §1.4): % de la producción bruta.
  // Lo descuenta de lo que el vasallo almacena y resolveWithinTx lo abona al señor.
  // 0 si el asentamiento es libre (tributePct = 0).
  tributeFood: number;
  tributeWood: number;
  tributeStone: number;
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

/** Niveles de las casas construidas (las que aún están levantándose, level 0, no cuentan). */
function houseLevels(buildings: SimBuilding[]): number[] {
  return buildings.filter((b) => b.type === BuildingType.HOUSE && b.level >= 1).map((b) => b.level);
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
  // % de producción que se cede al señor si este asentamiento es vasallo (§1.4).
  // 0 (por defecto) = asentamiento libre, sin tributo.
  tributePct = 0,
): SimResult {
  // Fracción de la producción que el vasallo cede (resto = lo que almacena).
  const tributeFrac = Math.max(0, Math.min(1, tributePct / 100));
  // Copia profunda del estado para no mutar la entrada.
  const state: SimSettlement = {
    ...input,
    buildings: input.buildings.map((b) => ({ ...b })),
  };

  const newEvents: NewEvent[] = [];
  let colonistsArrived = 0;
  let colonistsLost = 0;
  let buildingsCompleted = 0;
  // Producción bruta acumulada del tramo (no descuenta consumo ni tope de almacén).
  let producedFood = 0;
  let producedWood = 0;
  let producedStone = 0;
  // Tributo cedido al señor en todo el tramo (§1.4).
  let tributeFood = 0;
  let tributeWood = 0;
  let tributeStone = 0;

  // Completa las obras cuyo `constructionEndsAt` ya pasó en el instante `atMs`:
  // sube el edificio a `level + 1` (0→1 si era nuevo) y libera la obra. Si es el
  // Ayuntamiento, sube también el techo global del asentamiento.
  const completeConstructionsDue = (atMs: number): void => {
    for (const b of state.buildings) {
      if (b.constructionEndsAt && b.constructionEndsAt.getTime() <= atMs + 1e-6) {
        b.level += 1;
        b.constructionEndsAt = null;
        buildingsCompleted += 1;
        if (b.type === BuildingType.TOWN_HALL) state.townHallLevel += 1;
      }
    }
  };

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
    // Completa las obras terminadas justo antes de este tramo: cambian las tasas
    // (una granja nueva empieza a producir, una mejora rinde más) para el resto.
    completeConstructionsDue(cursor);

    // Tamaño del paso: como mucho STEP_HOURS y lo que reste, pero acortándolo para
    // caer EXACTO sobre la próxima obra que termine (así el tramo usa la config
    // correcta a ambos lados del corte, igual de fino que el resto del motor).
    let h = Math.min(STEP_HOURS, remainingHours);
    for (const b of state.buildings) {
      if (!b.constructionEndsAt) continue;
      const hToEnd = (b.constructionEndsAt.getTime() - cursor) / MS_PER_HOUR;
      if (hToEnd > 1e-9 && hToEnd < h) h = hToEnd;
    }
    const cap = storageCap(bestWarehouseLevel(state.buildings));
    const plagueOn = plagueActiveAt(activePlagues, new Date(cursor));
    if (plagueOn) plagueSeen = true;

    // --- Recursos acumulables: producir (con tope) ---
    const foodRate = ratePerHour(state.buildings, "food");
    const woodRate = ratePerHour(state.buildings, "wood");
    const stoneRate = ratePerHour(state.buildings, "stone");

    // Producción bruta del tramo (para los contadores acumulados de las hazañas):
    // lo que producen los edificios, antes de consumo y antes del tope de almacén.
    const foodGross = foodRate * h;
    const woodGross = woodRate * h;
    const stoneGross = stoneRate * h;
    producedFood += foodGross;
    producedWood += woodGross;
    producedStone += stoneGross;

    // Tributo (§1.4): el vasallo cede `tributeFrac` de su producción bruta al señor y
    // solo almacena el resto. El tributo NO depende del tope de almacén del vasallo.
    tributeFood += foodGross * tributeFrac;
    tributeWood += woodGross * tributeFrac;
    tributeStone += stoneGross * tributeFrac;
    const keep = 1 - tributeFrac;

    state.food = Math.min(cap, state.food + foodGross * keep);
    state.wood = Math.min(cap, state.wood + woodGross * keep);
    state.stone = Math.min(cap, state.stone + stoneGross * keep);

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
    const capacity = populationCapacity(houseLevels(state.buildings));
    const hasRoom = state.population < capacity;
    const foodSurplus = foodRate > state.population * CONSUMPTION.foodPerColonistPerHour;
    const welfareOk = state.welfare > POPULATION.growthWelfareThreshold;
    if (hasRoom && foodSurplus && welfareOk) {
      state.growthProgress += h;
      // El primer colono nuevo llega antes; los siguientes a la cadencia normal.
      let threshold = state.firstColonistReceived
        ? POPULATION.hoursPerColonist
        : POPULATION.firstColonistHours;
      while (state.growthProgress >= threshold && state.population < capacity) {
        state.population += 1;
        state.growthProgress -= threshold;
        state.firstColonistReceived = true;
        threshold = POPULATION.hoursPerColonist; // a partir de aquí, 24h
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

  // Cierre: completa lo que termine exactamente en `now` (el bucle solo completa
  // al INICIO de cada tramo), para que la vista lo muestre ya terminado.
  completeConstructionsDue(now.getTime());

  const summary: ResolveSummary = {
    elapsedHours,
    food: state.food - start.food,
    wood: state.wood - start.wood,
    stone: state.stone - start.stone,
    welfare: state.welfare - start.welfare,
    populationDelta: state.population - start.population,
    colonistsArrived,
    colonistsLost,
    buildingsCompleted,
    plagueActive: plagueSeen,
    producedFood,
    producedWood,
    producedStone,
    tributeFood,
    tributeWood,
    tributeStone,
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
    // overlord = vasallaje en el que ESTE asentamiento es el vasallo (su señor y el
    // % de tributo). null si es libre.
    include: { buildings: true, overlord: true },
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
    constructionEndsAt: b.constructionEndsAt,
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
    firstColonistReceived: settlement.firstColonistReceived,
    buildings: simBuildings,
  };

  const tributePct = settlement.overlord?.tributePct ?? 0;
  const { state, newEvents, summary } = simulate(
    input,
    settlement.lastTick,
    now,
    activePlagues,
    tributePct,
  );

  await tx.settlement.update({
    where: { id: settlementId },
    data: {
      // El Ayuntamiento puede haber subido de nivel al completarse su mejora.
      townHallLevel: state.townHallLevel,
      food: state.food,
      wood: state.wood,
      stone: state.stone,
      welfare: state.welfare,
      population: state.population,
      growthProgress: state.growthProgress,
      famineProgress: state.famineProgress,
      firstColonistReceived: state.firstColonistReceived,
      lastTick: now,
      // Acumular la producción bruta del tramo (para las hazañas total_*_produced).
      totalFoodProduced: { increment: summary.producedFood },
      totalWoodProduced: { increment: summary.producedWood },
      totalStoneProduced: { increment: summary.producedStone },
    },
  });

  // Persistir cambios por edificio: la hambruna puede retirar colonos y las obras
  // terminadas suben el nivel y liberan `constructionEndsAt`.
  for (let i = 0; i < settlement.buildings.length; i++) {
    const dbBuilding = settlement.buildings[i];
    const simBuilding = state.buildings[i];
    if (!simBuilding) continue;
    const dbEnds = dbBuilding.constructionEndsAt?.getTime() ?? null;
    const simEnds = simBuilding.constructionEndsAt?.getTime() ?? null;
    const changed =
      simBuilding.workers !== dbBuilding.workers ||
      simBuilding.level !== dbBuilding.level ||
      simEnds !== dbEnds;
    if (changed) {
      await tx.building.update({
        where: { id: dbBuilding.id },
        data: {
          workers: simBuilding.workers,
          level: simBuilding.level,
          constructionEndsAt: simBuilding.constructionEndsAt,
        },
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

  // Tributo al señor (§1.4): abona al señor lo que el vasallo cedió en este tramo.
  // Se suma a sus recursos almacenados (su propia resolución acotará al tope de
  // almacén) y a sus contadores informativos de tributo recibido. Si el señor está
  // por encima del tope, el exceso se descarta en su próximo recálculo (como toda
  // producción que rebosa). El abono es perezoso: ocurre cuando el VASALLO juega.
  const lordId = settlement.overlord?.lordId;
  const tributeTotal = summary.tributeFood + summary.tributeWood + summary.tributeStone;
  if (lordId && tributeTotal > 1e-9) {
    await tx.settlement.update({
      where: { id: lordId },
      data: {
        food: { increment: summary.tributeFood },
        wood: { increment: summary.tributeWood },
        stone: { increment: summary.tributeStone },
        tributeReceivedFood: { increment: summary.tributeFood },
        tributeReceivedWood: { increment: summary.tributeWood },
        tributeReceivedStone: { increment: summary.tributeStone },
      },
    });
  }

  return { summary, newEvents };
}

/** Resultado de cargar el asentamiento: incluye reacciones (hazañas, referidos). */
export interface LoadedSettlement extends ResolvedSettlement {
  newAchievements: CompletedAchievement[];
  referralActivated: boolean;
  // Nº de hazañas completadas pendientes de canje (badge de navegación).
  pendingClaims: number;
}

/**
 * Recalcula el estado diferido de un asentamiento y lo persiste, en su propia
 * transacción. Llamar al abrir la app (GET /api/settlement). Tras recalcular,
 * evalúa hazañas (producción acumulada, crecimiento de población, obras terminadas)
 * y activa la recompensa de referido si el Ayuntamiento acaba de llegar a N2.
 */
export async function resolveSettlement(settlementId: string): Promise<LoadedSettlement> {
  const now = new Date();
  // Import diferido: mantiene `simulate` puro y testeable sin tocar la DB.
  const { prisma } = await import("./prisma");
  return prisma.$transaction(async (tx) => {
    const resolved = await resolveWithinTx(tx, settlementId, now);
    const s = await tx.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      select: { userId: true, townHallLevel: true },
    });
    const referralActivated = await maybeActivateReferral(tx, s);
    const newAchievements = await evaluateAchievements(tx, settlementId);
    const pendingClaims = await countPendingClaims(tx, s.userId);
    return { ...resolved, newAchievements, referralActivated, pendingClaims };
  });
}
