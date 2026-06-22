// ============================================================================
// actions.ts — aplicación de acciones del jugador en el servidor.
//
// Flujo (§7): para CADA acción, dentro de una sola transacción:
//   1. resolveWithinTx → cierra el tramo de producción con la config anterior.
//   2. validateAction  → ¿es legal con el estado fresco? (recursos, topes, colonos)
//   3. aplicar el cambio y descontar el coste.
// Si la validación falla, se lanza ActionError y la transacción no se compromete.
// ============================================================================

import { resolveWithinTx, type ResolveSummary } from "./resolveSettlement";
import {
  validateAction,
  type Action,
  type Cost,
  type SettlementSnapshot,
} from "./validation";
import { constructionSeconds } from "./gameConfig";
import { BuildingType } from "./generated/prisma/enums";

export class ActionError extends Error {}

export interface ApplyActionResult {
  summary: ResolveSummary; // lo ocurrido mientras no estaba (al cerrar el tramo)
}

function buildSnapshot(settlement: {
  townHallLevel: number;
  food: number;
  wood: number;
  stone: number;
  population: number;
  buildings: {
    id: string;
    type: BuildingType;
    level: number;
    workers: number;
    constructionEndsAt: Date | null;
  }[];
}): SettlementSnapshot {
  return {
    townHallLevel: settlement.townHallLevel,
    food: settlement.food,
    wood: settlement.wood,
    stone: settlement.stone,
    population: settlement.population,
    buildings: settlement.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      level: b.level,
      workers: b.workers,
      constructing: b.constructionEndsAt !== null,
    })),
  };
}

/** Descuento de recursos a aplicar tras una acción con coste. */
function spendData(cost: Cost | undefined) {
  return {
    food: { decrement: cost?.food ?? 0 },
    wood: { decrement: cost?.wood ?? 0 },
    stone: { decrement: cost?.stone ?? 0 },
  };
}

export async function applyAction(
  settlementId: string,
  action: Action,
): Promise<ApplyActionResult> {
  const now = new Date();
  const { prisma } = await import("./prisma");

  return prisma.$transaction(async (tx) => {
    // 1. Cerrar el tramo de producción con la configuración anterior.
    const { summary } = await resolveWithinTx(tx, settlementId, now);

    // Estado fresco tras resolver.
    const settlement = await tx.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: { buildings: true },
    });
    const snapshot = buildSnapshot(settlement);

    // 2. Validar contra el estado fresco.
    const result = validateAction(snapshot, action);
    if (!result.ok) {
      throw new ActionError(result.error ?? "Acción no válida.");
    }

    // Instante en que terminará una obra encargada ahora.
    const endsAt = (type: BuildingType, targetLevel: number) =>
      new Date(now.getTime() + constructionSeconds(type, targetLevel) * 1000);

    // 3. Aplicar el cambio + descontar coste.
    // Las obras NO son instantáneas: se descuenta el coste ahora y el edificio
    // queda "en obra" (constructionEndsAt). El motor diferido lo completa al
    // cruzar ese instante (sube a level+1; 0→1 si es nuevo).
    switch (action.kind) {
      case "build": {
        await tx.building.create({
          data: {
            settlementId,
            type: action.buildingType,
            level: 0, // aún no funcional: sube a 1 al terminar la obra
            workers: 0,
            constructionEndsAt: endsAt(action.buildingType, 1),
          },
        });
        await tx.settlement.update({
          where: { id: settlementId },
          data: spendData(result.cost),
        });
        break;
      }
      case "upgrade": {
        const b = settlement.buildings.find((x) => x.id === action.buildingId)!;
        // Sigue produciendo a su nivel actual hasta que la mejora termine.
        await tx.building.update({
          where: { id: b.id },
          data: { constructionEndsAt: endsAt(b.type, b.level + 1) },
        });
        await tx.settlement.update({
          where: { id: settlementId },
          data: spendData(result.cost),
        });
        break;
      }
      case "upgradeTownHall": {
        // El techo global NO sube hasta que la obra termine (lo hace el motor).
        const th = settlement.buildings.find((x) => x.type === BuildingType.TOWN_HALL);
        if (th) {
          await tx.building.update({
            where: { id: th.id },
            data: { constructionEndsAt: endsAt(BuildingType.TOWN_HALL, settlement.townHallLevel + 1) },
          });
        }
        await tx.settlement.update({
          where: { id: settlementId },
          data: spendData(result.cost),
        });
        break;
      }
      case "assign": {
        await tx.building.update({
          where: { id: action.buildingId },
          data: { workers: action.workers },
        });
        break; // reasignar es gratis
      }
    }

    return { summary };
  });
}
