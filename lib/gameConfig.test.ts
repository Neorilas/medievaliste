import { describe, expect, it } from "vitest";
import {
  buildCost,
  constructionSeconds,
  maxWorkers,
  productionPerHour,
  storageCap,
  townHallUpgradeCost,
  upgradeCost,
  TOWN_HALL,
  MAX_TOWN_HALL_LEVEL,
} from "./gameConfig";
import { BuildingType } from "./generated/prisma/enums";

describe("buildCost", () => {
  it("devuelve el coste de cada edificio construible", () => {
    expect(buildCost(BuildingType.HOUSE)).toEqual({ wood: 15 });
    // La Cantera se construye solo con madera (única fuente de piedra).
    expect(buildCost(BuildingType.QUARRY)).toEqual({ wood: 30 });
  });

  it("el Ayuntamiento no es construible (coste vacío)", () => {
    expect(buildCost(BuildingType.TOWN_HALL)).toEqual({});
  });
});

describe("upgradeCost", () => {
  it("usa los costes explícitos cuando existen", () => {
    expect(upgradeCost(BuildingType.FARM, 2)).toEqual({ wood: 24 });
    expect(upgradeCost(BuildingType.WAREHOUSE, 2)).toEqual({ wood: 30, stone: 10 });
  });

  it("aplica la curva por defecto cuando el nivel no está listado", () => {
    // Granja N3 no listado → base {wood:18} * 1.3*(3-1) = 18*2.6 = 46.8 → ceil 47
    expect(upgradeCost(BuildingType.FARM, 3)).toEqual({ wood: 47 });
  });

  it("escala todos los recursos del coste base en la curva por defecto", () => {
    // House no tiene costes explícitos de mejora: usa la curva por defecto sobre
    // su base {wood:15}. N3 → factor 1.3*(3-1)=2.6 → ceil(15*2.6)=39.
    expect(upgradeCost(BuildingType.HOUSE, 3)).toEqual({ wood: 39 });
  });

  it("la Cantera tiene costes de mejora explícitos con piedra (construir es solo madera)", () => {
    expect(upgradeCost(BuildingType.QUARRY, 2)).toEqual({ wood: 30, stone: 15 });
    expect(upgradeCost(BuildingType.QUARRY, 3)).toEqual({ wood: 60, stone: 35 });
  });
});

describe("townHallUpgradeCost", () => {
  it("coincide con la tabla del Ayuntamiento", () => {
    // La primera mejora (N1→N2) es solo madera: rompe el bloqueo de la piedra.
    expect(townHallUpgradeCost(2)).toEqual({ wood: 55 });
    expect(townHallUpgradeCost(3)).toEqual({ wood: 300, stone: 120 });
  });

  it("nivel inexistente → coste vacío", () => {
    expect(townHallUpgradeCost(99)).toEqual({});
  });

  it("la tabla cubre hasta el nivel máximo", () => {
    expect(TOWN_HALL[MAX_TOWN_HALL_LEVEL]).toBeDefined();
  });
});

describe("storageCap", () => {
  it("niveles más allá de la tabla extrapolan con el último conocido", () => {
    expect(storageCap(99)).toBe(350); // tope del nivel 3
  });
  it("nivel negativo se trata como 0", () => {
    expect(storageCap(-5)).toBe(60);
  });
});

describe("maxWorkers / productionPerHour en niveles altos", () => {
  it("cada nivel añade un puesto", () => {
    expect(maxWorkers(BuildingType.SAWMILL, 1)).toBe(2);
    expect(maxWorkers(BuildingType.SAWMILL, 3)).toBe(4);
  });

  it("los puestos extra usan la última marginal definida, escalada por nivel", () => {
    // Serrería L1 marginales [2,3]; L3: x1.6^2=2.56; 4 puestos: 2,3,3,3 = 11 → *2.56
    const expected = (2 + 3 + 3 + 3) * Math.pow(1.6, 2);
    expect(productionPerHour(BuildingType.SAWMILL, 3, 4)).toBeCloseTo(expected, 5);
  });

  it("colonos por encima del tope no aportan nada extra", () => {
    const atCap = productionPerHour(BuildingType.SAWMILL, 3, 4);
    expect(productionPerHour(BuildingType.SAWMILL, 3, 10)).toBeCloseTo(atCap, 5);
  });

  it("un edificio en construcción (nivel 0) no admite colonos ni produce", () => {
    expect(maxWorkers(BuildingType.FARM, 0)).toBe(0);
    expect(productionPerHour(BuildingType.FARM, 0, 2)).toBe(0);
  });
});

describe("constructionSeconds (tiempo de obra)", () => {
  it("construir (nivel 1) usa el tiempo base del tipo", () => {
    expect(constructionSeconds(BuildingType.HOUSE, 1)).toBe(120);
    expect(constructionSeconds(BuildingType.QUARRY, 1)).toBe(240);
  });

  it("a mayor nivel objetivo, más tiempo", () => {
    const l1 = constructionSeconds(BuildingType.FARM, 1);
    const l2 = constructionSeconds(BuildingType.FARM, 2);
    const l3 = constructionSeconds(BuildingType.FARM, 3);
    expect(l2).toBeGreaterThan(l1);
    expect(l3).toBeGreaterThan(l2);
    // L2 = 180 * 1.8 = 324
    expect(l2).toBe(324);
  });

  it("el Ayuntamiento tiene su propia tabla, más lenta", () => {
    expect(constructionSeconds(BuildingType.TOWN_HALL, 2)).toBe(600);
    expect(constructionSeconds(BuildingType.TOWN_HALL, 3)).toBe(1800);
  });
});
