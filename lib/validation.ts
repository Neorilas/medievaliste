// ============================================================================
// validation.ts — validación de acciones legales. PURA (sin DB).
//
// El cliente NUNCA decide qué es legal: toda acción se valida aquí, en el
// servidor, contra la configuración (gameConfig) y el estado actual.
// ============================================================================

import {
  BUILD_MIN_TOWN_HALL,
  MAX_TOWN_HALL_LEVEL,
  PRODUCERS,
  TOWN_HALL,
  buildCost,
  maxWorkers,
  townHallUpgradeCost,
  upgradeCost,
  type Resource,
} from "./gameConfig";
import { BuildingType } from "./generated/prisma/enums";

export type Action =
  | { kind: "assign"; buildingId: string; workers: number }
  | { kind: "build"; buildingType: BuildingType }
  | { kind: "upgrade"; buildingId: string }
  | { kind: "upgradeTownHall" };

export interface BuildingSnapshot {
  id: string;
  type: BuildingType;
  level: number;
  workers: number;
}

export interface SettlementSnapshot {
  townHallLevel: number;
  food: number;
  wood: number;
  stone: number;
  population: number;
  buildings: BuildingSnapshot[];
}

export type Cost = Partial<Record<Resource, number>>;

export interface ValidationResult {
  ok: boolean;
  error?: string;
  cost?: Cost; // recursos a descontar si la acción es legal
}

// Recursos acumulables (welfare no lo es, por eso no entra aquí).
const RESOURCE_KEYS = ["food", "wood", "stone"] as const;

/** Colonos no asignados a ningún edificio. */
export function freeColonists(s: SettlementSnapshot): number {
  const assigned = s.buildings.reduce((a, b) => a + b.workers, 0);
  return s.population - assigned;
}

/** ¿Puede el asentamiento pagar este coste? */
export function canAfford(s: SettlementSnapshot, cost: Cost): boolean {
  for (const key of RESOURCE_KEYS) {
    const need = cost[key] ?? 0;
    if (need > 0 && s[key] < need) return false;
  }
  return true;
}

function ok(cost?: Cost): ValidationResult {
  return { ok: true, cost };
}
function fail(error: string): ValidationResult {
  return { ok: false, error };
}

function validateBuild(s: SettlementSnapshot, type: BuildingType): ValidationResult {
  if (type === BuildingType.TOWN_HALL) {
    return fail("El Ayuntamiento no se construye: ya existe y solo se mejora.");
  }
  const tier = TOWN_HALL[s.townHallLevel];
  if (!tier) return fail("Nivel de Ayuntamiento desconocido.");

  // Tope global de edificios (cuenta todos, incluido el Ayuntamiento).
  if (s.buildings.length >= tier.maxBuildings) {
    return fail(
      `Has alcanzado el máximo de edificios (${tier.maxBuildings}). Sube el Ayuntamiento.`,
    );
  }

  // Desbloqueo por nivel de Ayuntamiento (p. ej. la Cantera).
  const minTH = BUILD_MIN_TOWN_HALL[type];
  if (minTH && s.townHallLevel < minTH) {
    return fail(`Requiere Ayuntamiento N${minTH}.`);
  }

  const cost = buildCost(type);
  if (Object.keys(cost).length === 0) return fail("Tipo de edificio no construible.");
  if (!canAfford(s, cost)) return fail("Recursos insuficientes.");
  return ok(cost);
}

function validateUpgrade(s: SettlementSnapshot, buildingId: string): ValidationResult {
  const b = s.buildings.find((x) => x.id === buildingId);
  if (!b) return fail("El edificio no existe.");
  if (b.type === BuildingType.TOWN_HALL) {
    return fail("Usa la acción de subir Ayuntamiento.");
  }
  const tier = TOWN_HALL[s.townHallLevel];
  if (!tier) return fail("Nivel de Ayuntamiento desconocido.");

  const targetLevel = b.level + 1;
  if (targetLevel > tier.maxOtherLevel) {
    return fail(
      `Nivel máximo ${tier.maxOtherLevel} con este Ayuntamiento. Súbelo para mejorar más.`,
    );
  }
  const cost = upgradeCost(b.type, targetLevel);
  if (!canAfford(s, cost)) return fail("Recursos insuficientes.");
  return ok(cost);
}

function validateUpgradeTownHall(s: SettlementSnapshot): ValidationResult {
  const targetLevel = s.townHallLevel + 1;
  if (targetLevel > MAX_TOWN_HALL_LEVEL) {
    return fail("El Ayuntamiento ya está al nivel máximo.");
  }
  const cost = townHallUpgradeCost(targetLevel);
  if (!canAfford(s, cost)) return fail("Recursos insuficientes.");
  return ok(cost);
}

function validateAssign(
  s: SettlementSnapshot,
  buildingId: string,
  workers: number,
): ValidationResult {
  if (!Number.isInteger(workers) || workers < 0) {
    return fail("Número de colonos inválido.");
  }
  const b = s.buildings.find((x) => x.id === buildingId);
  if (!b) return fail("El edificio no existe.");
  if (!PRODUCERS[b.type]) {
    return fail("Este edificio no admite colonos.");
  }
  const slots = maxWorkers(b.type, b.level);
  if (workers > slots) {
    return fail(`Este edificio admite como máximo ${slots} colonos a su nivel.`);
  }
  // Tras el cambio, los colonos asignados totales no pueden superar la población.
  const assignedOthers = s.buildings.reduce(
    (a, x) => a + (x.id === buildingId ? 0 : x.workers),
    0,
  );
  if (assignedOthers + workers > s.population) {
    return fail("No hay colonos libres suficientes.");
  }
  return ok(); // reasignar es gratis (§4)
}

/** Valida cualquier acción contra el estado actual. No muta nada. */
export function validateAction(s: SettlementSnapshot, action: Action): ValidationResult {
  switch (action.kind) {
    case "build":
      return validateBuild(s, action.buildingType);
    case "upgrade":
      return validateUpgrade(s, action.buildingId);
    case "upgradeTownHall":
      return validateUpgradeTownHall(s);
    case "assign":
      return validateAssign(s, action.buildingId, action.workers);
    default:
      return fail("Acción desconocida.");
  }
}
