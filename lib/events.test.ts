import { describe, it, expect } from "vitest";
import {
  isEventDue,
  isInEarlyGame,
  pickEventType,
  isTradeType,
  buildTradePayload,
  buildInclemencyPayload,
  describeEvent,
  type GenContext,
} from "./events";
import { EVENTS } from "./gameConfig";
import { WorldEventType, WorldEventStatus } from "./generated/prisma/enums";

const EPOCH = new Date("2026-01-01T00:00:00Z");
const hours = (h: number) => new Date(EPOCH.getTime() + h * 3600_000);

describe("isInEarlyGame", () => {
  it("dentro de los primeros earlyGameDays", () => {
    expect(isInEarlyGame(EPOCH, hours(1))).toBe(true);
    expect(isInEarlyGame(EPOCH, hours(EVENTS.earlyGameDays * 24 - 1))).toBe(true);
    expect(isInEarlyGame(EPOCH, hours(EVENTS.earlyGameDays * 24 + 1))).toBe(false);
  });
});

describe("isEventDue", () => {
  const base = (over: Partial<GenContext>): GenContext => ({
    settlementId: "s1",
    createdAt: EPOCH,
    since: EPOCH,
    now: hours(1),
    resolvedCount: 0,
    ...over,
  });

  it("early game: no salta antes del intervalo mínimo", () => {
    const ctx = base({ now: hours(EVENTS.earlyIntervalHoursMin - 1) });
    expect(isEventDue(ctx)).toBe(false);
  });

  it("early game: salta una vez superado el intervalo máximo", () => {
    const ctx = base({ now: hours(EVENTS.earlyIntervalHoursMax + 1) });
    expect(isEventDue(ctx)).toBe(true);
  });

  it("fase normal: se fuerza un evento tras forceAfterHours sin ninguno", () => {
    // 'now' fuera del early game y 'since' muy atrás → supera el tope de 48h.
    const created = EPOCH;
    const now = hours(EVENTS.earlyGameDays * 24 + EVENTS.forceAfterHours + 1);
    const ctx = base({ createdAt: created, since: hours(EVENTS.earlyGameDays * 24), now });
    expect(isEventDue(ctx)).toBe(true);
  });

  it("no salta si no ha pasado tiempo", () => {
    expect(isEventDue(base({ now: EPOCH }))).toBe(false);
  });
});

describe("pickEventType (tabla d100)", () => {
  it("rangos: 1-70 trade, 71-95 inclemencia, 96-100 colono", () => {
    // rng() controla el roll: roll = floor(rng*100)+1.
    const typeForRoll = (rollMinus1: number, sub = 0) => {
      let calls = 0;
      const rng = () => (calls++ === 0 ? rollMinus1 / 100 : sub);
      return pickEventType(rng);
    };
    expect(isTradeType(typeForRoll(0, 0.1))).toBe(true); // roll 1 → trade favorable
    expect(typeForRoll(69, 0.9)).toBe(WorldEventType.TRADE_UNFAVORABLE); // roll 70, sub alto
    expect(typeForRoll(70)).toBe(WorldEventType.INCLEMENCY); // roll 71
    expect(typeForRoll(94)).toBe(WorldEventType.INCLEMENCY); // roll 95
    expect(typeForRoll(95)).toBe(WorldEventType.COLONIST_ARRIVAL); // roll 96
    expect(typeForRoll(99)).toBe(WorldEventType.COLONIST_ARRIVAL); // roll 100
  });
});

describe("buildTradePayload", () => {
  const resources = { food: 0, wood: 100, stone: 10 };
  const rng = () => 0.5; // jitter neutro

  it("favorable: el jugador recibe más de lo que entrega", () => {
    const p = buildTradePayload(WorldEventType.TRADE_FAVORABLE, resources, rng);
    // Entrega del recurso más abundante (wood), recibe el más escaso (food).
    expect(p.give.resource).toBe("wood");
    expect(p.receive.resource).toBe("food");
    expect(p.receive.amount).toBeGreaterThan(p.give.amount);
  });

  it("desfavorable: el jugador recibe menos de lo que entrega", () => {
    const p = buildTradePayload(WorldEventType.TRADE_UNFAVORABLE, resources, rng);
    expect(p.receive.amount).toBeLessThan(p.give.amount);
  });
});

describe("buildInclemencyPayload", () => {
  it("la pérdida recae sobre el recurso más abundante, acotada a [5,30]", () => {
    const p = buildInclemencyPayload({ food: 0, wood: 200, stone: 0 }, () => 0.5);
    expect(p.effect.resource).toBe("wood");
    expect(p.effect.amount).toBeGreaterThanOrEqual(5);
    expect(p.effect.amount).toBeLessThanOrEqual(30);
  });
});

describe("describeEvent", () => {
  it("trade: incluye personaje y mecánica de intercambio", () => {
    const view = describeEvent(
      {
        id: "e1",
        type: WorldEventType.TRADE_FAVORABLE,
        status: WorldEventStatus.PENDING,
        characterKey: "mercator_01",
        payload: { give: { resource: "wood", amount: 5 }, receive: { resource: "food", amount: 11 } },
        createdAt: EPOCH,
        expiresAt: hours(10),
      },
      EPOCH,
    );
    expect(view.isTrade).toBe(true);
    expect(view.character?.name).toBe("Gaius Mercátor");
    expect(view.mechanic).toContain("11 de comida");
    expect(view.secondsRemaining).toBe(10 * 3600);
  });

  it("inclemencia: sin personaje, texto objetivo", () => {
    const view = describeEvent(
      {
        id: "e2",
        type: WorldEventType.INCLEMENCY,
        status: WorldEventStatus.PENDING,
        characterKey: null,
        payload: { effect: { resource: "food", amount: 12 } },
        createdAt: EPOCH,
        expiresAt: hours(10),
      },
      EPOCH,
    );
    expect(view.character).toBeNull();
    expect(view.mechanic).toContain("−12 de comida");
  });
});
