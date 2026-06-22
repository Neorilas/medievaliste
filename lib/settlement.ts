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
  BUILD_MIN_TOWN_HALL,
  INITIAL,
  MAX_TOWN_HALL_LEVEL,
  PRODUCERS,
  TOWN_HALL,
  buildCost,
  cancelDeadlineMs,
  constructionSeconds,
  maxWorkers,
  populationCapacity,
  productionPerHour,
  storageCap,
  townHallUpgradeCost,
  upgradeCost,
  upgradePreview,
  CONSUMPTION,
  militaryForce,
  MILITARY,
  type StatDelta,
} from "./gameConfig";
import { validateAction, type Cost, type SettlementSnapshot } from "./validation";
import { BuildingType, Region } from "./generated/prisma/enums";
import { REGIONS } from "./regionConfig";
import { renameCooldownRemaining } from "./settlementIdentity";
import { parseTutorialProgress, type TutorialProgress } from "./tutorial";
import { REFERRAL_REWARD } from "./referrals";

// Tipos de edificio que el jugador puede construir (el Ayuntamiento ya existe).
const BUILDABLE: BuildingType[] = [
  BuildingType.FARM,
  BuildingType.SAWMILL,
  BuildingType.QUARRY,
  BuildingType.HOUSE,
  BuildingType.WAREHOUSE,
  BuildingType.PLAZA,
  BuildingType.BARRACKS,
  BuildingType.WALL,
];

/** Asegura que el usuario tiene un asentamiento (lo crea en el primer acceso) y devuelve su id. */
export async function getOrCreateSettlementForUser(userId: string): Promise<string> {
  const { prisma } = await import("./prisma");

  const existing = await prisma.settlement.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Bonus de bienvenida por referido (Bloque 3): si el usuario se registró con un
  // enlace de invitación válido, su asentamiento arranca con 25 de cada recurso
  // extra. Se aplica aquí (creación única) para no duplicarlo.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referredById: true },
  });
  const bonus = user?.referredById ? REFERRAL_REWARD : { wood: 0, food: 0, stone: 0 };

  // Crea el asentamiento inicial + edificios de partida para este usuario.
  const settlement = await prisma.settlement.create({
    data: {
      userId,
      name: "Mi Asentamiento",
      townHallLevel: INITIAL.townHallLevel,
      food: INITIAL.food + bonus.food,
      wood: INITIAL.wood + bonus.wood,
      stone: INITIAL.stone + bonus.stone,
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
  durationSeconds: number; // cuánto tardará la mejora
  atMax: boolean; // ya está en el nivel máximo permitido (sin mejora posible)
  preview: StatDelta[]; // qué stat cambia al subir de nivel (Cambio B2)
}

export interface BuildingView {
  id: string;
  type: BuildingType;
  level: number;
  workers: number;
  maxWorkers: number; // puestos a este nivel
  productionPerHour: number; // producción actual del edificio
  produces: string | null; // recurso que produce, o null
  // ¿Admite colonos? Productores y Cuartel (soldados). Distinto de `produces`: el
  // Cuartel acepta colonos pero no produce un recurso acumulable (genera fuerza).
  acceptsWorkers: boolean;
  upgrade: UpgradeInfo | null; // null para el Ayuntamiento (usa townHallUpgrade)
  // Obra en curso (construcción inicial o mejora). null si está terminado.
  construction: {
    endsAt: string; // ISO del instante en que termina
    totalSeconds: number; // duración total de esta obra (para barra de progreso)
    toLevel: number; // nivel que tendrá al terminar
    cancelableUntil: string; // ISO del instante hasta el que se puede cancelar y recuperar el coste
  } | null;
}

export interface BuildOption {
  type: BuildingType;
  cost: Cost;
  canBuild: boolean;
  reason?: string;
  durationSeconds: number; // cuánto tardará en construirse
  // Nivel de Ayuntamiento que falta para desbloquear este edificio, o null si ya
  // está desbloqueado. Cuando no es null, la UI lo muestra bloqueado (candado),
  // independientemente de si el jugador puede pagarlo (Cambio A).
  lockedByTownHall: number | null;
}

export interface TownHallUpgrade {
  atMax: boolean;
  cost: Cost;
  canUpgrade: boolean;
  reason?: string;
  durationSeconds: number; // cuánto tardará la mejora
  preview: StatDelta[]; // qué cambia al subir el Ayuntamiento (Cambio B2)
}

export interface SettlementView {
  id: string;
  name: string;
  // Renombre (CAMBIO 1): cuánto falta para poder volver a cambiar el nombre.
  rename: {
    canRename: boolean;
    cooldownSecondsRemaining: number; // 0 si ya puede
  };
  // Región (CAMBIO 3): null si el jugador aún no la ha elegido (onboarding pendiente).
  region: Region | null;
  regionName: string | null;
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
  // Pasos del tutorial ya vistos (Cambio C). El cliente decide cuándo mostrar cada
  // coachmark pendiente según el estado del juego.
  tutorialProgress: TutorialProgress;
  unseenEvents: {
    id: string;
    type: string;
    payload: unknown;
    occurredAt: string;
  }[];
  // Conquista y vasallaje (Bloque 6, §1).
  military: MilitaryView;
}

export interface MilitaryView {
  // Fuerza militar propia (cuartel + muralla + recursos). §1.2
  force: number;
  // Mi señor, si soy vasallo (null = libre). Incluye el % de producción que cedo.
  lord: { name: string; tributePct: number } | null;
  // ¿Puedo rebelarme ya? (soy vasallo y mi fuerza supera la del señor). §1.5
  canRebel: boolean;
  // Mis vasallos (si soy señor).
  vassals: { name: string; tributePct: number }[];
  // Tributo TOTAL recibido como señor a lo largo del tiempo (línea informativa). §1.4
  tributeReceived: { food: number; wood: number; stone: number };
  // Historial reciente de guerras que me involucran (para enterarme de ataques sufridos).
  recentWars: {
    role: "attacker" | "defender";
    opponentName: string;
    won: boolean; // ¿gané yo?
    isRebellion: boolean;
    at: string; // ISO
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
      // Vasallaje (Bloque 6): mi señor (con sus edificios/recursos para estimar si
      // ya puedo rebelarme) y mis vasallos.
      overlord: {
        include: {
          lord: { select: { name: true, buildings: true, food: true, wood: true, stone: true } },
        },
      },
      vassals: { include: { vassal: { select: { name: true } } } },
    },
  });

  // Historial reciente de guerras que involucran a este asentamiento (§1: para que
  // el defensor se entere de ataques sufridos al volver a entrar).
  const recentWarRows = await prisma.warDeclaration.findMany({
    where: { OR: [{ attackerId: settlementId }, { defenderId: settlementId }] },
    orderBy: { declaredAt: "desc" },
    take: 5,
    include: {
      attacker: { select: { id: true, name: true } },
      defender: { select: { id: true, name: true } },
    },
  });

  // Las casas aún en obra (level 0) no suben la capacidad todavía. Cada casa
  // aporta techo según su nivel (Cambio B2), de ahí la lista de niveles.
  const houseLevels = s.buildings
    .filter((b) => b.type === BuildingType.HOUSE && b.level >= 1)
    .map((b) => b.level);
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
      constructing: b.constructionEndsAt !== null,
    })),
  };

  const buildings: BuildingView[] = s.buildings.map((b) => {
    const producer = PRODUCERS[b.type];
    let upgrade: UpgradeInfo | null = null;
    if (b.type !== BuildingType.TOWN_HALL) {
      const res = validateAction(snapshot, { kind: "upgrade", buildingId: b.id });
      const atMax = b.level >= tier.maxOtherLevel;
      upgrade = {
        cost: upgradeCost(b.type, b.level + 1),
        canUpgrade: res.ok,
        reason: res.error,
        durationSeconds: constructionSeconds(b.type, b.level + 1),
        atMax,
        preview: atMax ? [] : upgradePreview(b.type, b.level),
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
      acceptsWorkers: !!producer || b.type === BuildingType.BARRACKS,
      upgrade,
      construction: b.constructionEndsAt
        ? {
            endsAt: b.constructionEndsAt.toISOString(),
            totalSeconds: constructionSeconds(b.type, b.level + 1),
            toLevel: b.level + 1,
            cancelableUntil: new Date(
              cancelDeadlineMs({
                type: b.type,
                level: b.level,
                townHallLevel: s.townHallLevel,
                endsAt: b.constructionEndsAt,
              }),
            ).toISOString(),
          }
        : null,
    };
  });

  const buildOptions: BuildOption[] = BUILDABLE.map((type) => {
    const res = validateAction(snapshot, { kind: "build", buildingType: type });
    const minTH = BUILD_MIN_TOWN_HALL[type];
    const locked = minTH && s.townHallLevel < minTH ? minTH : null;
    return {
      type,
      cost: buildCost(type),
      canBuild: res.ok,
      reason: res.error,
      durationSeconds: constructionSeconds(type, 1),
      lockedByTownHall: locked,
    };
  });

  const thAtMax = s.townHallLevel >= MAX_TOWN_HALL_LEVEL;
  const thRes = validateAction(snapshot, { kind: "upgradeTownHall" });
  const townHallUpgrade: TownHallUpgrade = {
    atMax: thAtMax,
    cost: thAtMax ? {} : townHallUpgradeCost(s.townHallLevel + 1),
    canUpgrade: thRes.ok,
    reason: thRes.error,
    durationSeconds: thAtMax
      ? 0
      : constructionSeconds(BuildingType.TOWN_HALL, s.townHallLevel + 1),
    preview: thAtMax ? [] : upgradePreview(BuildingType.TOWN_HALL, s.townHallLevel),
  };

  const sumRate = (type: BuildingType) =>
    s.buildings
      .filter((b) => b.type === type)
      .reduce((a, b) => a + productionPerHour(b.type, b.level, b.workers), 0);

  const foodConsumption = s.population * CONSUMPTION.foodPerColonistPerHour;
  const assigned = s.buildings.reduce((a, b) => a + b.workers, 0);

  const cooldownRemaining = renameCooldownRemaining(s.nameChangedAt);

  // --- Bloque militar (§1) ---
  const ownForce = militaryForce({
    buildings: s.buildings,
    food: s.food,
    wood: s.wood,
    stone: s.stone,
  });
  // Estimación de si puedo rebelarme: mi fuerza > la de mi señor (con sus recursos
  // almacenados actuales). El endpoint de rebelión vuelve a comprobarlo tras cerrar
  // el tramo de ambos, así que esto es solo una pista para la UI.
  let canRebel = false;
  if (s.overlord) {
    const lord = s.overlord.lord;
    const lordForce = militaryForce({
      buildings: lord.buildings,
      food: lord.food,
      wood: lord.wood,
      stone: lord.stone,
    });
    canRebel = ownForce > lordForce;
  }
  const military: MilitaryView = {
    force: ownForce,
    lord: s.overlord ? { name: s.overlord.lord.name, tributePct: s.overlord.tributePct } : null,
    canRebel,
    vassals: s.vassals.map((v) => ({ name: v.vassal.name, tributePct: v.tributePct })),
    tributeReceived: {
      food: s.tributeReceivedFood,
      wood: s.tributeReceivedWood,
      stone: s.tributeReceivedStone,
    },
    recentWars: recentWarRows.map((w) => {
      const role = w.attackerId === settlementId ? "attacker" : "defender";
      return {
        role,
        opponentName: role === "attacker" ? w.defender.name : w.attacker.name,
        won: w.winnerId === settlementId,
        isRebellion: w.isRebellion,
        at: w.declaredAt.toISOString(),
      } as const;
    }),
  };

  return {
    id: s.id,
    name: s.name,
    rename: {
      canRename: cooldownRemaining === 0,
      cooldownSecondsRemaining: cooldownRemaining,
    },
    region: s.region,
    regionName: s.region ? REGIONS[s.region].name : null,
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
      capacity: populationCapacity(houseLevels),
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
    tutorialProgress: parseTutorialProgress(s.tutorialProgress),
    unseenEvents: s.events.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt.toISOString(),
    })),
    military,
  };
}
