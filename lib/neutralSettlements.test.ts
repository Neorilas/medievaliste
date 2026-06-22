import { describe, it, expect } from "vitest";
import { generateNeutrals, generatePlayerPosition } from "./neutralSettlements";
import { REGIONS } from "./regionConfig";
import { Region } from "./generated/prisma/enums";

describe("generateNeutrals", () => {
  it("genera exactamente el nº de neutrales configurado por región", () => {
    for (const region of Object.values(Region)) {
      const got = generateNeutrals(region);
      expect(got.length).toBe(REGIONS[region].neutralCount);
    }
  });

  it("es determinista: misma región → mismo resultado", () => {
    const a = generateNeutrals(Region.BAETICA);
    const b = generateNeutrals(Region.BAETICA);
    expect(a).toEqual(b);
  });

  it("posiciones dentro del tablero 0–100 y niveles 1–3", () => {
    for (const n of generateNeutrals(Region.TARRACONENSIS)) {
      expect(n.posX).toBeGreaterThanOrEqual(0);
      expect(n.posX).toBeLessThanOrEqual(100);
      expect(n.posY).toBeGreaterThanOrEqual(0);
      expect(n.posY).toBeLessThanOrEqual(100);
      expect(n.level).toBeGreaterThanOrEqual(1);
      expect(n.level).toBeLessThanOrEqual(3);
    }
  });

  it("nombres únicos dentro de la región", () => {
    const names = generateNeutrals(Region.BAETICA).map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("generatePlayerPosition", () => {
  it("es determinista por settlementId", () => {
    const a = generatePlayerPosition("abc", []);
    const b = generatePlayerPosition("abc", []);
    expect(a).toEqual(b);
  });
  it("queda dentro del tablero", () => {
    const p = generatePlayerPosition("xyz", generateNeutrals(Region.LUSITANIA));
    expect(p.posX).toBeGreaterThanOrEqual(0);
    expect(p.posX).toBeLessThanOrEqual(100);
    expect(p.posY).toBeGreaterThanOrEqual(0);
    expect(p.posY).toBeLessThanOrEqual(100);
  });
});
