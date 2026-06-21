// ============================================================================
// settlement.ts — bootstrap y vista del asentamiento.
//
// `getSettlementView` arma el estado completo que el cliente necesita para
// pintar (recursos con sus topes, población, edificios con su producción actual,
// eventos sin ver). El cliente solo MUESTRA; no calcula nada.
//
// El asentamiento pertenece al usuario de la sesión (Auth.js). Se crea en el
// primer acceso al juego vía `getOrCreateSettlementForUser`.
// ============================================================================

import {
  INITIAL,
  MAX_TOWN_HALL_LEVEL,
  PRODUCERS,
  TOWN_HALL,
  buildCost,
  maxWorkers,
  populationCapacity,
  productionPerHour,
  storageCap,
  townHallUpgradeCost,
  upgradeCost,
  CONSUMPTION,
} from "./gameConfig";
import { validateAction, type Cost, type SettlementSnapshot } from "./validation";
import { BuildingType } from "./generated/prisma/enums";

// Tipos de edificio que el jugador puede construir (el Ayuntamiento ya existe).
const BUILDABLE: BuildingType[] = [
  BuildingType.FARM,
  BuildingType.SAWMILL,
  BuildingType.QUARRY,
  BuildingType.HOUSE,
  BuildingType.WAREHOUSE,
  BuildingType.PLAZA,
];

/** Asegura que el usuario tiene un asentamiento (lo crea en el primer acceso) y devuelve su id. */
export async function getOrCreateSettlementForUser(userId: string): Promise<string> {
  const { prisma } = await import("./prisma");

  const existing = await prisma.settlement.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Crea el asentamiento inicial + edificios de partida para este usuario.
  const settlement = await prisma.settlement.create({
    data: {
      userId,
      name: "Mi Asentamiento",
      townHallLevel: INITIAL.townHallLevel,
      food: INITIAL.food,
      wood: INITIAL.wood,
      stone: INITIAL.stone,
      welfare: INITIAL.welfare,
      population: INITIAL.population,
      buildings: {
        create: INITIAL.buildings.map((b) => ({
          type: b.type,
          level: b.level,
          workers: b.workers,
        })),
      },
    },
    select: { id: true },
  });
  return settlement.id;
}

export interface UpgradeInfo {
  cost: Cost;
  canUpgrade: boolean;
  reason?: string; // por qué no se puede (si canUpgrade es false)
}

export interface BuildingView {
  id: string;
  type: BuildingType;
  level: number;
  workers: number;
  maxWorkers: number; // puestos a este nivel
  productionPerHour: number; // producción actual del edificio
  produces: string | null; // recurso que produce, o null
  upgrade: UpgradeInfo | null; // null para el Ayuntamiento (usa townHallUpgrade)
}

export interface BuildOption {
  type: BuildingType;
  cost: Cost;
  canBuild: boolean;
  reason?: string;
}

export interface TownHallUpgrade {
  atMax: boolean;
  cost: Cost;
  canUpgrade: boolean;
  reason?: string;
}

export interface SettlementView {
  id: string;
  name: string;
  townHallLevel: number;
  maxBuildings: number;
  maxOtherLevel: number;
  resources: {
    food: number;
    wood: number;
    stone: number;
    cap: number; // tope por recurso acumulable
  };
  welfare: number;
  population: {
    total: number;
    free: number; // colonos sin asignar
    capacity: number; // techo dado por las casas
  };
  rates: {
    food: number; // producción neta de comida/hora (producción - consumo)
    wood: number;
    stone: number;
    foodConsumption: number;
  };
  buildings: BuildingView[];
  buildOptions: BuildOption[];
  townHallUpgrade: TownHallUpgrade;
  unseenEvents: {
    id: string;
    type: string;
    payload: unknown;
    occurredAt: string;
  }[];
}

/** Estado completo del asentamiento para el cliente. NO recalcula (eso es resolveSettlement). */
export async function getSettlementView(settlementId: string): Promise<SettlementView> {
  const { prisma } = await import("./prisma");

  const s = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    include: {
      buildings: { orderBy: { createdAt: "asc" } },
      events: { where: { seen: false }, orderBy: { occurredAt: "asc" } },
    },
  });

  const houseCount = s.buildings.filter((b) => b.type === BuildingType.HOUSE).length;
  const bestWarehouse = s.buildings
    .filter((b) => b.type === BuildingType.WAREHOUSE)
    .reduce((m, b) => Math.max(m, b.level), 0);
  const cap = storageCap(bestWarehouse);
  const tier = TOWN_HALL[s.townHallLevel] ?? TOWN_HALL[1];

  // Snapshot para reutilizar la validación (misma lógica que aplica las acciones).
  const snapshot: SettlementSnapshot = {
    townHallLevel: s.townHallLevel,
    food: s.food,
    wood: s.wood,
    stone: s.stone,
    population: s.population,
    buildings: s.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      level: b.level,
      workers: b.workers,
    })),
  };

  const buildings: BuildingView[] = s.buildings.map((b) => {
    const producer = PRODUCERS[b.type];
    let upgrade: UpgradeInfo | null = null;
    if (b.type !== BuildingType.TOWN_HALL) {
      const res = validateAction(snapshot, { kind: "upgrade", buildingId: b.id });
      upgrade = {
        cost: upgradeCost(b.type, b.level + 1),
        canUpgrade: res.ok,
        reason: res.error,
      };
    }
    return {
      id: b.id,
      type: b.type,
      level: b.level,
      workers: b.workers,
      maxWorkers: maxWorkers(b.type, b.level),
      productionPerHour: productionPerHour(b.type, b.level, b.workers),
      produces: producer ? producer.resource : null,
      upgrade,
    };
  });

  const buildOptions: BuildOption[] = BUILDABLE.map((type) => {
    const res = validateAction(snapshot, { kind: "build", buildingType: type });
    return { type, cost: buildCost(type), canBuild: res.ok, reason: res.error };
  });

  const thAtMax = s.townHallLevel >= MAX_TOWN_HALL_LEVEL;
  const thRes = validateAction(snapshot, { kind: "upgradeTownHall" });
  const townHallUpgrade: TownHallUpgrade = {
    atMax: thAtMax,
    cost: thAtMax ? {} : townHallUpgradeCost(s.townHallLevel + 1),
    canUpgrade: thRes.ok,
    reason: thRes.error,
  };

  const sumRate = (type: BuildingType) =>
    s.buildings
      .filter((b) => b.type === type)
      .reduce((a, b) => a + productionPerHour(b.type, b.level, b.workers), 0);

  const foodConsumption = s.population * CONSUMPTION.foodPerColonistPerHour;
  const assigned = s.buildings.reduce((a, b) => a + b.workers, 0);

  return {
    id: s.id,
    name: s.name,
    townHallLevel: s.townHallLevel,
    maxBuildings: tier.maxBuildings,
    maxOtherLevel: tier.maxOtherLevel,
    resources: {
      food: s.food,
      wood: s.wood,
      stone: s.stone,
      cap,
    },
    welfare: s.welfare,
    population: {
      total: s.population,
      free: s.population - assigned,
      capacity: populationCapacity(houseCount),
    },
    rates: {
      food: sumRate(BuildingType.FARM) - foodConsumption,
      wood: sumRate(BuildingType.SAWMILL),
      stone: sumRate(BuildingType.QUARRY),
      foodConsumption,
    },
    buildings,
    buildOptions,
    townHallUpgrade,
    unseenEvents: s.events.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
}
