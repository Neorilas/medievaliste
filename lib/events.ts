// ============================================================================
// events.ts — sistema de eventos aleatorios (Bloque 4 §B).
//
// Mercaderes que ofrecen tratos, inclemencias que aplican un efecto y peregrini
// que traen colonos. Igual que gameConfig/achievements, la NARRATIVA, el pool de
// personajes y la lógica viven en código; la BD solo guarda los eventos generados
// (modelo WorldEvent). Los NÚMEROS de balance viven en gameConfig.ts (EVENTS).
//
// Generación DIFERIDA: no hay cron. Al abrir la app, `generateEventIfDue` compara
// el instante actual con la creación del asentamiento y la resolución del último
// evento, y crea uno nuevo si toca. Como mucho 1 evento activo (PENDING) a la vez:
// el timer del siguiente no corre hasta que el actual se resuelve.
// ============================================================================

import { EVENTS, storageCap } from "./gameConfig";
import { WorldEventType, WorldEventStatus, BuildingType } from "./generated/prisma/enums";
import type { Prisma } from "./generated/prisma/client";
import { resolveWithinTx } from "./resolveSettlement";
import { evaluateAchievements, type CompletedAchievement } from "./achievements";

const MS_PER_HOUR = 1000 * 60 * 60;

// Recursos que pueden intercambiarse o perderse en un evento (no welfare).
export type TradeResource = "food" | "wood" | "stone";
const TRADE_RESOURCES: TradeResource[] = ["food", "wood", "stone"];

const RESOURCE_NOUN: Record<TradeResource, string> = {
  food: "comida",
  wood: "madera",
  stone: "piedra",
};

export class EventError extends Error {}

// ----------------------------------------------------------------------------
// Pool de personajes (la región como factor queda diferida a fase futura).
// `line` es el sabor narrativo; el origen y nombre se muestran como contexto.
// ----------------------------------------------------------------------------
export interface Character {
  key: string;
  name: string;
  origin: string;
  line: string;
}

// Mercatores: aparecen en los intercambios (TRADE_*).
const MERCATORES: Character[] = [
  {
    key: "mercator_01",
    name: "Gaius Mercátor",
    origin: "Siria",
    line: "Que los dioses te sonrían, amigo. Traigo géneros de Oriente y una oferta que no querrás dejar pasar.",
  },
  {
    key: "mercator_02",
    name: "Lucius Hadrianus",
    origin: "Carthago Nova",
    line: "El tiempo es denarios. Te propongo un trato; piénsalo, pero no demasiado.",
  },
  {
    key: "mercator_03",
    name: "Marcus Vibius",
    origin: "Roma",
    line: "Mis contactos en el Senado hablan bien de ti. Quizá tú y yo podamos entendernos.",
  },
  {
    key: "mercator_04",
    name: "Quintus Servilius",
    origin: "Emerita Augusta",
    line: "Trato directo y precio justo, como debe ser entre gente honrada. Mira lo que te ofrezco.",
  },
  {
    key: "mercator_05",
    name: "Titus Varro",
    origin: "Gades",
    line: "Ah, una ganga única… o casi. Échale un vistazo, no te arrepentirás. Probablemente.",
  },
];

// Peregrini: aparecen en las llegadas de colonos (COLONIST_ARRIVAL).
const PEREGRINI: Character[] = [
  {
    key: "peregrini_01",
    name: "Verónica et familia",
    origin: "Lusitania",
    line: "Venimos de lejos, con los niños a cuestas. Buscamos un techo y manos dispuestas a trabajar.",
  },
  {
    key: "peregrini_02",
    name: "Barcino el alfarero",
    origin: "Barcino",
    line: "Sé tornear el barro y pido poco. Dame sitio y verás cuánto rindo.",
  },
  {
    key: "peregrini_03",
    name: "Flavia la viuda",
    origin: "Hispalis",
    line: "No vengo a pedir limosna, sino a ganarme el pan en tu asentamiento.",
  },
  {
    key: "peregrini_04",
    name: "Ambatus el celtíbero",
    origin: "Celtiberia",
    line: "No me fío fácil… pero si me acoges, tendrás un aliado para siempre.",
  },
];

const ALL_CHARACTERS = new Map<string, Character>(
  [...MERCATORES, ...PEREGRINI].map((c) => [c.key, c]),
);

export function getCharacter(key: string | null | undefined): Character | null {
  if (!key) return null;
  return ALL_CHARACTERS.get(key) ?? null;
}

// Textos objetivos de inclemencia (sin personaje). Se elige uno de forma estable
// por id de evento en describeEvent.
const INCLEMENCY_TEXTS: string[] = [
  "Una tormenta de granizo arrasa parte de las cosechas y reservas.",
  "Las lluvias del estío pudren parte de lo almacenado en los graneros.",
  "Un brote de roya echa a perder parte de las provisiones.",
  "Vientos del norte derriban estructuras y dispersan los suministros.",
];

// ----------------------------------------------------------------------------
// RNG determinista por semilla (para que la DECISIÓN de generar no cambie entre
// llamadas repetidas del GET dentro del mismo ciclo). Una vez decidido generar,
// el tipo y el payload concretos usan Math.random (se persisten una sola vez).
// ----------------------------------------------------------------------------
function hashStr(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Un valor pseudoaleatorio estable en [0,1) a partir de una semilla de texto. */
function seeded(seed: string): number {
  let a = hashStr(seed);
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ----------------------------------------------------------------------------
// Decisión de generación (PURA). Devuelve si toca generar un evento ahora.
// ----------------------------------------------------------------------------
export interface GenContext {
  settlementId: string;
  createdAt: Date;
  since: Date; // referencia del timer: resolución del último evento o createdAt
  now: Date;
  resolvedCount: number; // nº de eventos ya resueltos (semilla estable por ciclo)
}

export function isInEarlyGame(createdAt: Date, now: Date): boolean {
  return now.getTime() < createdAt.getTime() + EVENTS.earlyGameDays * 24 * MS_PER_HOUR;
}

export function isEventDue(ctx: GenContext): boolean {
  const elapsedHours = (ctx.now.getTime() - ctx.since.getTime()) / MS_PER_HOUR;
  if (elapsedHours <= 0) return false;

  if (isInEarlyGame(ctx.createdAt, ctx.now)) {
    // Un evento cada [min, max] horas, con el umbral fijado de forma estable por ciclo.
    const r = seeded(`${ctx.settlementId}:early:${ctx.resolvedCount}`);
    const threshold =
      EVENTS.earlyIntervalHoursMin +
      r * (EVENTS.earlyIntervalHoursMax - EVENTS.earlyIntervalHoursMin);
    return elapsedHours >= threshold;
  }

  // Fase normal: tope de 48h sin evento fuerza uno; si no, tirada por hora.
  if (elapsedHours >= EVENTS.forceAfterHours) return true;
  const wholeHours = Math.floor(elapsedHours);
  for (let h = 1; h <= wholeHours; h++) {
    if (seeded(`${ctx.settlementId}:h${ctx.resolvedCount}:${h}`) < EVENTS.hourlyProbability) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------------------
// Tabla d100: tipo de evento una vez confirmado que debe generarse.
// 1–70 trade · 71–95 inclemencia · 96–100 llegada de colono.
// (MILITARY y SPECIAL quedan reservados para fases futuras.)
// ----------------------------------------------------------------------------
export function pickEventType(rng: () => number): WorldEventType {
  const roll = Math.floor(rng() * 100) + 1; // 1..100
  if (roll <= 70) {
    // Variante del trato: favorable 40% · neutral 35% · desfavorable 25%.
    const sub = rng();
    if (sub < 0.4) return WorldEventType.TRADE_FAVORABLE;
    if (sub < 0.75) return WorldEventType.TRADE_NEUTRAL;
    return WorldEventType.TRADE_UNFAVORABLE;
  }
  if (roll <= 95) return WorldEventType.INCLEMENCY;
  return WorldEventType.COLONIST_ARRIVAL;
}

const TRADE_TYPES = new Set<WorldEventType>([
  WorldEventType.TRADE_FAVORABLE,
  WorldEventType.TRADE_NEUTRAL,
  WorldEventType.TRADE_UNFAVORABLE,
]);

export function isTradeType(type: WorldEventType): boolean {
  return TRADE_TYPES.has(type);
}

// ----------------------------------------------------------------------------
// Payloads
// ----------------------------------------------------------------------------
export interface TradePayload {
  give: { resource: TradeResource; amount: number };
  receive: { resource: TradeResource; amount: number };
}
export interface InclemencyPayload {
  effect: { resource: TradeResource; amount: number }; // amount = pérdida
}
export interface ColonistPayload {
  effect: { colonist: number };
}

interface Resources {
  food: number;
  wood: number;
  stone: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Recurso del que el jugador tiene MÁS (para que el trato/inclemencia sea pagable/sensible). */
function richestResource(r: Resources): TradeResource {
  return TRADE_RESOURCES.reduce((best, k) => (r[k] > r[best] ? k : best), TRADE_RESOURCES[0]);
}
/** Recurso del que el jugador tiene MENOS y que NO sea `exclude` (lo que más necesita). */
function poorestResource(r: Resources, exclude: TradeResource): TradeResource {
  const opts = TRADE_RESOURCES.filter((k) => k !== exclude);
  return opts.reduce((best, k) => (r[k] < r[best] ? k : best), opts[0]);
}

// Ratio recibir/entregar según la variante (favorable = el jugador sale ganando).
const TRADE_RATIO: Record<string, number> = {
  [WorldEventType.TRADE_FAVORABLE]: 2.2,
  [WorldEventType.TRADE_NEUTRAL]: 1.0,
  [WorldEventType.TRADE_UNFAVORABLE]: 0.55,
};

export function buildTradePayload(
  type: WorldEventType,
  resources: Resources,
  rng: () => number,
): TradePayload {
  const giveRes = richestResource(resources);
  const receiveRes = poorestResource(resources, giveRes);
  const have = resources[giveRes];
  // Entrega ~30% de lo que más tiene, acotada a [5, 40]; un pequeño jitter para variar.
  const jitter = 0.85 + rng() * 0.3;
  const giveAmount = clamp(Math.round(have * 0.3 * jitter), 5, 40);
  const ratio = TRADE_RATIO[type] ?? 1;
  const receiveAmount = Math.max(1, Math.round(giveAmount * ratio));
  return {
    give: { resource: giveRes, amount: giveAmount },
    receive: { resource: receiveRes, amount: receiveAmount },
  };
}

export function buildInclemencyPayload(resources: Resources, rng: () => number): InclemencyPayload {
  const res = richestResource(resources);
  const jitter = 0.85 + rng() * 0.3;
  // Pérdida ~20% de lo que más tiene, acotada a [5, 30].
  const amount = clamp(Math.round(resources[res] * 0.2 * jitter), 5, 30);
  return { effect: { resource: res, amount } };
}

// ----------------------------------------------------------------------------
// Vista serializada de un evento para el cliente (el cliente solo MUESTRA).
// ----------------------------------------------------------------------------
export interface EventView {
  id: string;
  type: WorldEventType;
  status: WorldEventStatus;
  isTrade: boolean;
  character: { key: string; name: string; origin: string } | null;
  narrative: string;
  mechanic: string;
  payload: TradePayload | InclemencyPayload | ColonistPayload;
  createdAt: string;
  expiresAt: string;
  secondsRemaining: number;
}

interface WorldEventRow {
  id: string;
  type: WorldEventType;
  status: WorldEventStatus;
  characterKey: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
  expiresAt: Date;
}

export function describeEvent(e: WorldEventRow, now: Date = new Date()): EventView {
  const isTrade = isTradeType(e.type);
  const character = getCharacter(e.characterKey);
  const payload = e.payload as unknown as TradePayload & InclemencyPayload & ColonistPayload;

  let narrative: string;
  let mechanic: string;

  if (isTrade) {
    narrative = character?.line ?? "Un mercader se acerca con una propuesta.";
    const g = payload.give;
    const r = payload.receive;
    mechanic = `Ofrece ${r.amount} de ${RESOURCE_NOUN[r.resource]} a cambio de ${g.amount} de ${RESOURCE_NOUN[g.resource]}.`;
  } else if (e.type === WorldEventType.COLONIST_ARRIVAL) {
    narrative = character?.line ?? "Unos viajeros piden quedarse en tu asentamiento.";
    const n = payload.effect.colonist ?? 1;
    mechanic = `Se ${n === 1 ? "une 1 colono" : `unen ${n} colonos`} a tu asentamiento.`;
  } else {
    // INCLEMENCY: texto objetivo estable por id, sin personaje.
    narrative = INCLEMENCY_TEXTS[hashStr(e.id) % INCLEMENCY_TEXTS.length];
    const eff = payload.effect;
    mechanic = `Efecto: −${eff.amount} de ${RESOURCE_NOUN[eff.resource]}.`;
  }

  const secondsRemaining = Math.max(0, Math.round((e.expiresAt.getTime() - now.getTime()) / 1000));

  return {
    id: e.id,
    type: e.type,
    status: e.status,
    isTrade,
    character: character ? { key: character.key, name: character.name, origin: character.origin } : null,
    narrative,
    mechanic,
    payload,
    createdAt: e.createdAt.toISOString(),
    expiresAt: e.expiresAt.toISOString(),
    secondsRemaining,
  };
}

// ----------------------------------------------------------------------------
// Generación diferida (E/S). Llamada desde GET /api/events/pending.
// ----------------------------------------------------------------------------

/**
 * Crea un evento si procede y devuelve el evento PENDING activo (el nuevo o el que
 * ya estuviera abierto), o null si no hay ninguno. Expira el evento activo si su
 * plazo de respuesta venció (sin penalización para el jugador).
 */
export async function generateEventIfDue(
  settlementId: string,
  now: Date = new Date(),
): Promise<WorldEventRow | null> {
  const { prisma } = await import("./prisma");

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({
      where: { id: settlementId },
      select: { id: true, createdAt: true, food: true, wood: true, stone: true },
    });
    if (!settlement) return null;

    // Evento activo: si venció su plazo, pasa a EXPIRED (sin penalización).
    const pending = await tx.worldEvent.findFirst({
      where: { settlementId, status: WorldEventStatus.PENDING },
      orderBy: { createdAt: "desc" },
    });
    if (pending) {
      if (now.getTime() >= pending.expiresAt.getTime()) {
        await tx.worldEvent.update({
          where: { id: pending.id },
          data: { status: WorldEventStatus.EXPIRED, resolvedAt: pending.expiresAt },
        });
        // cae al cálculo de "¿toca generar uno nuevo?"
      } else {
        return pending; // aún hay uno abierto: no se genera nada más
      }
    }

    // Referencia del timer: resolución del último evento resuelto, o la creación.
    const lastResolved = await tx.worldEvent.findFirst({
      where: { settlementId, status: { not: WorldEventStatus.PENDING }, resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      select: { resolvedAt: true },
    });
    const since = lastResolved?.resolvedAt ?? settlement.createdAt;

    const resolvedCount = await tx.worldEvent.count({
      where: { settlementId, status: { not: WorldEventStatus.PENDING } },
    });
    const totalCount = await tx.worldEvent.count({ where: { settlementId } });

    const due = isEventDue({ settlementId, createdAt: settlement.createdAt, since, now, resolvedCount });
    if (!due) return null;

    // Tipo del evento. El PRIMER evento del early game es siempre un trato favorable
    // garantizado con un mercader (§B.2). El resto, por la tabla d100.
    const rng = Math.random;
    const firstEverInEarlyGame = totalCount === 0 && isInEarlyGame(settlement.createdAt, now);
    const type = firstEverInEarlyGame ? WorldEventType.TRADE_FAVORABLE : pickEventType(rng);

    const resources = { food: settlement.food, wood: settlement.wood, stone: settlement.stone };
    let characterKey: string | null = null;
    let payload: TradePayload | InclemencyPayload | ColonistPayload;

    if (isTradeType(type)) {
      characterKey = MERCATORES[Math.floor(rng() * MERCATORES.length)].key;
      payload = buildTradePayload(type, resources, rng);
    } else if (type === WorldEventType.COLONIST_ARRIVAL) {
      characterKey = PEREGRINI[Math.floor(rng() * PEREGRINI.length)].key;
      payload = { effect: { colonist: 1 } };
    } else {
      payload = buildInclemencyPayload(resources, rng);
    }

    const created = await tx.worldEvent.create({
      data: {
        settlementId,
        type,
        status: WorldEventStatus.PENDING,
        characterKey,
        payload: payload as object,
        expiresAt: new Date(now.getTime() + EVENTS.responseHours * MS_PER_HOUR),
      },
    });
    await tx.settlement.update({ where: { id: settlementId }, data: { lastEventAt: now } });
    return created;
  });
}

// ----------------------------------------------------------------------------
// Resolución de un evento (E/S). Llamada desde POST /api/events/[id]/resolve.
// ----------------------------------------------------------------------------
export type EventAction = "accept" | "decline";

export interface ResolveEventResult {
  status: WorldEventStatus;
  newAchievements: CompletedAchievement[];
}

function bestWarehouseLevel(buildings: { type: BuildingType; level: number }[]): number {
  return buildings
    .filter((b) => b.type === BuildingType.WAREHOUSE)
    .reduce((m, b) => Math.max(m, b.level), 0);
}

/**
 * Resuelve un evento (aceptar/rechazar) en su propia transacción. Antes cierra el
 * tramo de producción (resolveWithinTx) para no aplicar el efecto sobre estado
 * obsoleto, luego aplica el efecto/trato y evalúa hazañas sobre el estado fresco.
 */
export async function resolveEvent(
  settlementId: string,
  eventId: string,
  action: EventAction,
  now: Date = new Date(),
): Promise<ResolveEventResult> {
  const { prisma } = await import("./prisma");

  return prisma.$transaction(async (tx) => {
    // Cierra el tramo con la configuración anterior antes de tocar recursos.
    await resolveWithinTx(tx, settlementId, now);

    const event = await tx.worldEvent.findUnique({ where: { id: eventId } });
    if (!event || event.settlementId !== settlementId) {
      throw new EventError("El evento no existe.");
    }
    if (event.status !== WorldEventStatus.PENDING) {
      throw new EventError("Este evento ya se resolvió.");
    }
    if (now.getTime() >= event.expiresAt.getTime()) {
      await tx.worldEvent.update({
        where: { id: eventId },
        data: { status: WorldEventStatus.EXPIRED, resolvedAt: event.expiresAt },
      });
      throw new EventError("El evento ha expirado.");
    }

    const settlement = await tx.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: { buildings: true },
    });
    const cap = storageCap(bestWarehouseLevel(settlement.buildings));

    let status: WorldEventStatus = WorldEventStatus.ACCEPTED;

    if (isTradeType(event.type)) {
      if (action === "decline") {
        status = WorldEventStatus.DECLINED;
      } else {
        const p = event.payload as unknown as TradePayload;
        if (settlement[p.give.resource] < p.give.amount) {
          throw new EventError(
            `No tienes ${p.give.amount} de ${RESOURCE_NOUN[p.give.resource]} para este trato.`,
          );
        }
        const data: Record<string, number> = {};
        data[p.give.resource] = settlement[p.give.resource] - p.give.amount;
        // El recibido respeta el tope del almacén.
        const after = data[p.receive.resource] ?? settlement[p.receive.resource];
        data[p.receive.resource] = Math.min(cap, after + p.receive.amount);
        await tx.settlement.update({ where: { id: settlementId }, data });
        status = WorldEventStatus.ACCEPTED;
      }
    } else if (event.type === WorldEventType.COLONIST_ARRIVAL) {
      const p = event.payload as unknown as ColonistPayload;
      await tx.settlement.update({
        where: { id: settlementId },
        data: { population: { increment: p.effect.colonist ?? 1 } },
      });
    } else {
      // INCLEMENCY: efecto directo (pérdida), acotado a 0.
      const p = event.payload as unknown as InclemencyPayload;
      const current = settlement[p.effect.resource];
      await tx.settlement.update({
        where: { id: settlementId },
        data: { [p.effect.resource]: Math.max(0, current - p.effect.amount) },
      });
    }

    await tx.worldEvent.update({
      where: { id: eventId },
      data: { status, resolvedAt: now },
    });

    // Un colono nuevo o recursos pueden completar hazañas.
    const newAchievements = await evaluateAchievements(tx, settlementId);
    return { status, newAchievements };
  });
}
