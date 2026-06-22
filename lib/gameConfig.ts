// ============================================================================
// gameConfig.ts — TODAS las reglas y números de balance de Asentamiento v0.
//
// Estos números son IGUALES para todos los jugadores y deben poder rebalancearse
// sin tocar datos de nadie ni recompilar lógica. NUNCA incrustar balance fuera
// de este archivo.
//
// ⚠️ TODOS LOS NÚMEROS SON VALORES DE PARTIDA, A CALIBRAR JUGANDO. Están elegidos
// para cumplir las dos restricciones duras del diseño:
//   1. El almacén se llena en ~12h de producción a tasa plena (ritmo de 2 visitas/día).
//   2. La población crece como mucho 1 colono / 24h.
// y para que el asentamiento sea autosuficiente desde el minuto cero.
// ============================================================================

import { BuildingType } from "./generated/prisma/enums";

export type Resource = "food" | "wood" | "stone" | "welfare";

// ----------------------------------------------------------------------------
// Estado inicial del asentamiento
// ----------------------------------------------------------------------------
export const INITIAL = {
  population: 3,
  welfare: 100,
  food: 0,
  wood: 15, // colchón para la primera construcción
  stone: 0,
  townHallLevel: 1,
  // Edificios con los que arranca todo asentamiento nuevo.
  // La Granja arranca con 2 de los 3 colonos ya asignados → +3 comida/h netos,
  // autosuficiente desde el minuto cero (verificación §4-bis). El 3.º queda libre.
  buildings: [
    { type: BuildingType.TOWN_HALL, level: 1, workers: 0 },
    { type: BuildingType.FARM, level: 1, workers: 2 },
  ] as ReadonlyArray<{ type: BuildingType; level: number; workers: number }>,
} as const;

// ----------------------------------------------------------------------------
// Consumo de población
// ----------------------------------------------------------------------------
export const CONSUMPTION = {
  // Todos los colonos comen, trabajen o no.
  foodPerColonistPerHour: 1,
  // Drenaje base de bienestar por colono y hora.
  // ARRANCA EN 0 a propósito (§4-bis "arrancar simple"): así el bienestar es
  // estable al inicio (que NO tiene Plaza) y solo cae por hambre o plaga, tal y
  // como describe la cadena de crisis (§5). La Plaza sirve para RECUPERARLO.
  // Subir este valor por encima de 0 hace que la población cueste bienestar y
  // obliga a construir Plazas para sostenerla. PIEZA MÁS DIFÍCIL DE CALIBRAR.
  welfareDrainPerColonistPerHour: 0,
  // Penalización extra de bienestar por hora cuando hay hambre (comida a 0 y
  // déficit): es el motor de la cadena de crisis (§5). Domina sobre todo lo demás.
  welfareStarvationPenaltyPerHour: 8,
} as const;

// ----------------------------------------------------------------------------
// Producción por asignación de colonos
//
// Modelo: rendimiento marginal por puesto. `marginalsL1[i]` es la producción/hora
// que aporta el (i+1)-ésimo colono en un edificio de NIVEL 1. La producción total
// con `w` colonos es la suma de las primeras `w` marginales.
//
// Patrón de diseño: el 2º colono rinde MÁS que el 1º (premia concentrar), pero hay
// un tope de puestos por nivel (obliga a mejorar/construir más para crecer).
//
// Cada nivel por encima de 1:
//   - multiplica cada marginal por `levelYieldFactor`,
//   - añade `extraWorkerSlotsPerLevel` puestos (usando la última marginal definida).
// ----------------------------------------------------------------------------
export interface ProducerConfig {
  resource: Resource;
  marginalsL1: number[];
  levelYieldFactor: number;
  extraWorkerSlotsPerLevel: number;
}

export const PRODUCERS: Partial<Record<BuildingType, ProducerConfig>> = {
  // Granja: 1 col → 2/h, 2 col → 6/h (marginales 2 y 4).
  [BuildingType.FARM]: {
    resource: "food",
    marginalsL1: [2, 4],
    levelYieldFactor: 1.6,
    extraWorkerSlotsPerLevel: 1,
  },
  // Serrería: 1 col → 2/h, 2 col → 5/h.
  [BuildingType.SAWMILL]: {
    resource: "wood",
    marginalsL1: [2, 3],
    levelYieldFactor: 1.6,
    extraWorkerSlotsPerLevel: 1,
  },
  // Cantera: 1 col → 2/h, 2 col → 5/h.
  [BuildingType.QUARRY]: {
    resource: "stone",
    marginalsL1: [2, 3],
    levelYieldFactor: 1.6,
    extraWorkerSlotsPerLevel: 1,
  },
  // Plaza: genera bienestar. Arranca simple; curva a afinar jugando (§4-bis).
  [BuildingType.PLAZA]: {
    resource: "welfare",
    marginalsL1: [3, 5],
    levelYieldFactor: 1.5,
    extraWorkerSlotsPerLevel: 1,
  },
};

/** Nº máximo de colonos que un edificio puede emplear útilmente a este nivel. */
export function maxWorkers(type: BuildingType, level: number): number {
  const cfg = PRODUCERS[type];
  if (!cfg || level < 1) return 0; // level 0 = aún en construcción, no admite colonos
  return cfg.marginalsL1.length + (level - 1) * cfg.extraWorkerSlotsPerLevel;
}

/** Producción/hora de un edificio dado su tipo, nivel y colonos asignados. */
export function productionPerHour(
  type: BuildingType,
  level: number,
  workers: number,
): number {
  const cfg = PRODUCERS[type];
  if (!cfg || workers <= 0 || level < 1) return 0;

  const slots = maxWorkers(type, level);
  const effective = Math.min(workers, slots);
  const lastMarginal = cfg.marginalsL1[cfg.marginalsL1.length - 1];
  const levelMultiplier = Math.pow(cfg.levelYieldFactor, level - 1);

  let total = 0;
  for (let i = 0; i < effective; i++) {
    const marginal = i < cfg.marginalsL1.length ? cfg.marginalsL1[i] : lastMarginal;
    total += marginal;
  }
  return total * levelMultiplier;
}

// ----------------------------------------------------------------------------
// Almacenamiento (Almacén → tope de cada recurso acumulable)
// Verificación 12h: tope 60 con producción early ~5/h → se llena en 12h. ✓
// ----------------------------------------------------------------------------
export const WAREHOUSE_CAP_BY_LEVEL: Record<number, number> = {
  0: 60, // sin almacén construido: tope base
  1: 60,
  2: 150,
  3: 350,
};

/** Tope de cada recurso acumulable según el MEJOR almacén del asentamiento. */
export function storageCap(bestWarehouseLevel: number): number {
  const lvl = Math.max(0, bestWarehouseLevel);
  const known = WAREHOUSE_CAP_BY_LEVEL[lvl];
  if (known !== undefined) return known;
  // Niveles más allá de la tabla: extrapolar con el último conocido.
  const max = Math.max(...Object.keys(WAREHOUSE_CAP_BY_LEVEL).map(Number));
  return WAREHOUSE_CAP_BY_LEVEL[max];
}

// El bienestar NO es un recurso acumulable: es un porcentaje 0..100.
export const WELFARE_MIN = 0;
export const WELFARE_MAX = 100;

// ----------------------------------------------------------------------------
// Población: capacidad y crecimiento
// ----------------------------------------------------------------------------
export const POPULATION = {
  baseCapacity: 3, // capacidad sin casas
  // Cada Casa habilita `capacityPerHouse * nivel` colonos: una Casa N1 da +2,
  // N2 da +4, N3 da +6. Así MEJORAR una Casa tiene un efecto tangible (Cambio B2).
  capacityPerHouse: 2,
  // Crecimiento: +1 colono cada 24h de tiempo ELEGIBLE acumulado.
  hoursPerColonist: 24,
  // El bienestar debe estar por encima de este umbral para que crezca la población.
  growthWelfareThreshold: 70,
} as const;

/** Colonos que habilita una Casa según su nivel (0 si aún está en obra). */
export function houseCapacity(level: number): number {
  return level >= 1 ? level * POPULATION.capacityPerHouse : 0;
}

/** Capacidad de población dada por las casas (sin contar el techo del Ayuntamiento). */
export function populationCapacity(houseLevels: number[]): number {
  return POPULATION.baseCapacity + houseLevels.reduce((a, lvl) => a + houseCapacity(lvl), 0);
}

// ----------------------------------------------------------------------------
// Crisis y pérdida de población (§5): siempre avisada, nunca de golpe.
// Mientras bienestar > 70%, NO se pierde a nadie. Por debajo y sostenido,
// se pierde 1 colono cada `hoursPerLoss` de tiempo acumulado bajo umbral.
// ----------------------------------------------------------------------------
export const FAMINE = {
  welfareThreshold: 70, // línea roja explícita
  hoursPerLoss: 6, // horas sostenidas bajo umbral por cada colono perdido
} as const;

// ----------------------------------------------------------------------------
// Ayuntamiento (TOWN_HALL) — el limitador maestro. Deliberadamente lento.
// Define nº máx. de edificios y nivel máx. de cualquier otro edificio.
// ----------------------------------------------------------------------------
export interface TownHallTier {
  maxBuildings: number;
  maxOtherLevel: number;
  upgradeCost: Partial<Record<Resource, number>>; // coste para SUBIR A este nivel
}

export const TOWN_HALL: Record<number, TownHallTier> = {
  1: { maxBuildings: 4, maxOtherLevel: 2, upgradeCost: {} }, // inicial
  // La PRIMERA mejora (N1→N2) cuesta SOLO MADERA y debe ser pagable dentro del
  // tope de almacén inicial (60): sin piedra todavía no se puede ampliar el almacén
  // (la mejora de Almacén pide piedra), así que un coste >60 sería inalcanzable.
  // Esta mejora es la que DESBLOQUEA la Cantera (BUILD_MIN_TOWN_HALL), rompiendo el
  // bloqueo "sin cantera no hay piedra → sin piedra no se sube el Ayuntamiento".
  2: { maxBuildings: 6, maxOtherLevel: 3, upgradeCost: { wood: 55 } },
  3: { maxBuildings: 9, maxOtherLevel: 4, upgradeCost: { wood: 300, stone: 120 } },
} as const;

export const MAX_TOWN_HALL_LEVEL = 3;

// ----------------------------------------------------------------------------
// Costes de construcción y mejora de edificios (NO Ayuntamiento).
// ----------------------------------------------------------------------------
// Nivel mínimo de Ayuntamiento para poder CONSTRUIR cada tipo.
// La Cantera "se desbloquea más tarde" (§3): requiere Ayuntamiento N2.
export const BUILD_MIN_TOWN_HALL: Partial<Record<BuildingType, number>> = {
  [BuildingType.QUARRY]: 2,
};

// Coste de CONSTRUIR un edificio nuevo (siempre a nivel 1).
export const BUILD_COST: Partial<Record<BuildingType, Partial<Record<Resource, number>>>> = {
  [BuildingType.HOUSE]: { wood: 15 },
  [BuildingType.PLAZA]: { wood: 20 },
  [BuildingType.SAWMILL]: { wood: 15 },
  // La Cantera es la ÚNICA fuente de piedra; por eso su PRIMERA construcción no
  // puede costar piedra (sería inconstruible). Coste solo madera. Su mejora sí
  // escala con piedra una vez que ya genera (curva por defecto).
  [BuildingType.QUARRY]: { wood: 30 },
  [BuildingType.FARM]: { wood: 18 },
  [BuildingType.WAREHOUSE]: { wood: 25 },
  // TOWN_HALL no se construye: existe desde el inicio y solo se mejora.
};

// Coste de MEJORAR un edificio a `targetLevel` (el nivel al que sube).
// Si un nivel no está listado, se usa la curva por defecto (ver upgradeCost()).
export const UPGRADE_COST: Partial<
  Record<BuildingType, Record<number, Partial<Record<Resource, number>>>>
> = {
  [BuildingType.FARM]: { 2: { wood: 24 } },
  [BuildingType.SAWMILL]: { 2: { wood: 20 } },
  [BuildingType.WAREHOUSE]: { 2: { wood: 30, stone: 10 } },
  // La Cantera se CONSTRUYE solo con madera (única fuente de piedra), pero MEJORARLA
  // sí cuesta piedra una vez que ya la genera. Explícito para no heredar la curva
  // por defecto (que sería solo madera al venir de un coste base sin piedra).
  [BuildingType.QUARRY]: { 2: { wood: 30, stone: 15 }, 3: { wood: 60, stone: 35 } },
};

/** Coste de subir un edificio a `targetLevel`. */
export function upgradeCost(
  type: BuildingType,
  targetLevel: number,
): Partial<Record<Resource, number>> {
  const explicit = UPGRADE_COST[type]?.[targetLevel];
  if (explicit) return explicit;
  // Curva por defecto: escala el coste de construcción base con el nivel objetivo.
  const base = BUILD_COST[type] ?? { wood: 20 };
  const factor = 1.3 * (targetLevel - 1);
  const out: Partial<Record<Resource, number>> = {};
  for (const [res, amount] of Object.entries(base)) {
    out[res as Resource] = Math.ceil((amount as number) * factor);
  }
  return out;
}

/** Coste de construir un edificio nuevo. */
export function buildCost(type: BuildingType): Partial<Record<Resource, number>> {
  return BUILD_COST[type] ?? {};
}

/** Coste de subir el Ayuntamiento al `targetLevel`. */
export function townHallUpgradeCost(
  targetLevel: number,
): Partial<Record<Resource, number>> {
  return TOWN_HALL[targetLevel]?.upgradeCost ?? {};
}

// ----------------------------------------------------------------------------
// Tiempo de construcción y mejora (§ nuevo): los edificios NO son instantáneos.
// A mayor nivel objetivo, más tiempo. El motor diferido (resolveSettlement) los
// completa al cruzar el timestamp `constructionEndsAt`; mientras tanto un edificio
// nuevo (nivel 0) no produce y una mejora sigue produciendo a su nivel actual.
//
// ⚠️ VALORES DE PARTIDA, a calibrar jugando. En minutos para que se note sin
// frustrar al ritmo de ~2 visitas/día del diseño.
// ----------------------------------------------------------------------------
export const CONSTRUCTION = {
  // Segundos para CONSTRUIR cada tipo (llegar a nivel 1).
  baseSecondsByType: {
    [BuildingType.HOUSE]: 120, // 2 min
    [BuildingType.FARM]: 180, // 3 min
    [BuildingType.SAWMILL]: 180,
    [BuildingType.QUARRY]: 240, // 4 min
    [BuildingType.WAREHOUSE]: 240,
    [BuildingType.PLAZA]: 180,
  } as Partial<Record<BuildingType, number>>,
  // Tiempo base si un tipo no está en la tabla.
  fallbackBaseSeconds: 180,
  // Cada nivel objetivo por encima de 1 multiplica el tiempo por este factor.
  // L1=base, L2=base*1.8, L3=base*3.24, L4=base*5.83 …
  levelTimeFactor: 1.8,
  // Ayuntamiento: el limitador maestro, deliberadamente más lento.
  townHallSecondsByLevel: {
    2: 600, // 10 min
    3: 1800, // 30 min
  } as Record<number, number>,
  townHallFallbackSeconds: 1800,
} as const;

/**
 * Segundos que tarda en construirse/mejorarse un edificio hasta `targetLevel`.
 * `targetLevel === 1` es construir uno nuevo; >1 es mejorar a ese nivel.
 */
export function constructionSeconds(type: BuildingType, targetLevel: number): number {
  if (type === BuildingType.TOWN_HALL) {
    return CONSTRUCTION.townHallSecondsByLevel[targetLevel] ?? CONSTRUCTION.townHallFallbackSeconds;
  }
  const base = CONSTRUCTION.baseSecondsByType[type] ?? CONSTRUCTION.fallbackBaseSeconds;
  return Math.round(base * Math.pow(CONSTRUCTION.levelTimeFactor, Math.max(0, targetLevel - 1)));
}

// ----------------------------------------------------------------------------
// Identidad del asentamiento: renombre.
// El jugador puede renombrar su asentamiento, pero solo 1 vez cada 24h.
// ----------------------------------------------------------------------------
export const SETTLEMENT_NAME = {
  cooldownHours: 24,
  minLength: 3,
  maxLength: 32,
} as const;

// ----------------------------------------------------------------------------
// Eventos (§6): plaga.
// ----------------------------------------------------------------------------
export const PLAGUE = {
  // Drenaje extra de bienestar/hora mientras una plaga está activa.
  welfareDrainPerHour: 5,
} as const;

// ----------------------------------------------------------------------------
// Preview de mejora (Cambio B2): qué stat relevante cambia al subir de nivel.
// Devuelve SOLO el delta que importa de cada edificio (menos es más), como
// pares "valor actual → valor siguiente nivel". El cliente solo lo pinta.
// ----------------------------------------------------------------------------
export interface StatDelta {
  label: string;
  from: number;
  to: number;
}

const RESOURCE_NOUN: Record<Resource, string> = {
  food: "comida",
  wood: "madera",
  stone: "piedra",
  welfare: "bienestar",
};

/**
 * Resumen del cambio de stats de un edificio al pasar de `currentLevel` al
 * siguiente. Lista vacía si el edificio no gana nada medible (o no procede).
 */
export function upgradePreview(type: BuildingType, currentLevel: number): StatDelta[] {
  const next = currentLevel + 1;

  // Productores: producción máxima/h (con todos los puestos del nivel ocupados).
  const producer = PRODUCERS[type];
  if (producer) {
    return [
      {
        label: `Producción de ${RESOURCE_NOUN[producer.resource]} (máx/h)`,
        from: Math.round(productionPerHour(type, currentLevel, maxWorkers(type, currentLevel))),
        to: Math.round(productionPerHour(type, next, maxWorkers(type, next))),
      },
    ];
  }

  if (type === BuildingType.HOUSE) {
    return [
      { label: "Habitantes habilitados", from: houseCapacity(currentLevel), to: houseCapacity(next) },
    ];
  }

  if (type === BuildingType.WAREHOUSE) {
    return [
      { label: "Capacidad de almacén", from: storageCap(currentLevel), to: storageCap(next) },
    ];
  }

  if (type === BuildingType.TOWN_HALL) {
    const cur = TOWN_HALL[currentLevel];
    const nxt = TOWN_HALL[next];
    if (!cur || !nxt) return [];
    const out: StatDelta[] = [];
    if (nxt.maxBuildings !== cur.maxBuildings) {
      out.push({ label: "Edificios máximos", from: cur.maxBuildings, to: nxt.maxBuildings });
    }
    if (nxt.maxOtherLevel !== cur.maxOtherLevel) {
      out.push({ label: "Nivel máx. de edificios", from: cur.maxOtherLevel, to: nxt.maxOtherLevel });
    }
    return out;
  }

  return [];
}
