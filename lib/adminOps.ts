// Acciones de debug de admin, como función reutilizable y testeable.
// La ruta /api/admin/op solo hace auth + parseo y delega aquí.
import { prisma } from "./prisma";
import { resolveSettlement, type ResolveSummary } from "./resolveSettlement";
import { INITIAL, PLAGUE } from "./gameConfig";
import { EventType } from "./generated/prisma/enums";

export type AdminOp =
  | "setResources"
  | "addResources"
  | "setPopulation"
  | "setWelfare"
  | "resolve"
  | "plague"
  | "reset";

export class AdminOpError extends Error {}

export interface AdminOpResult {
  summary?: ResolveSummary;
}

function num(v: unknown, fallback?: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Si hay más colonos asignados que población, retira el exceso de los edificios. */
async function clampWorkers(settlementId: string) {
  const s = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    include: { buildings: { orderBy: { createdAt: "asc" } } },
  });
  let excess = s.buildings.reduce((a, b) => a + b.workers, 0) - s.population;
  for (const b of s.buildings) {
    if (excess <= 0) break;
    const take = Math.min(b.workers, excess);
    if (take > 0) {
      await prisma.building.update({ where: { id: b.id }, data: { workers: b.workers - take } });
      excess -= take;
    }
  }
}

export async function applyAdminOp(
  settlementId: string,
  op: AdminOp | string,
  payload: Record<string, unknown> = {},
): Promise<AdminOpResult> {
  const exists = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: { id: true },
  });
  if (!exists) throw new AdminOpError("Asentamiento no encontrado.");

  switch (op) {
    case "setResources": {
      await prisma.settlement.update({
        where: { id: settlementId },
        data: { food: num(payload.food), wood: num(payload.wood), stone: num(payload.stone) },
      });
      return {};
    }
    case "addResources": {
      await prisma.settlement.update({
        where: { id: settlementId },
        data: {
          food: { increment: num(payload.food, 0)! },
          wood: { increment: num(payload.wood, 0)! },
          stone: { increment: num(payload.stone, 0)! },
        },
      });
      return {};
    }
    case "setPopulation": {
      const population = num(payload.population);
      if (population === undefined || population < 0) {
        throw new AdminOpError("Población inválida.");
      }
      await prisma.settlement.update({ where: { id: settlementId }, data: { population } });
      await clampWorkers(settlementId);
      return {};
    }
    case "setWelfare": {
      const welfare = num(payload.welfare);
      if (welfare === undefined) throw new AdminOpError("Bienestar inválido.");
      await prisma.settlement.update({
        where: { id: settlementId },
        data: { welfare: Math.max(0, Math.min(100, welfare)) },
      });
      return {};
    }
    case "resolve": {
      const result = await resolveSettlement(settlementId);
      return { summary: result.summary };
    }
    case "plague": {
      const hours = num(payload.hours, 6)!;
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      await prisma.event.create({
        data: {
          settlementId,
          type: EventType.PLAGUE,
          payload: { until: until.toISOString(), drainPerHour: PLAGUE.welfareDrainPerHour },
        },
      });
      return {};
    }
    case "reset": {
      await prisma.$transaction(async (tx) => {
        await tx.event.deleteMany({ where: { settlementId } });
        await tx.building.deleteMany({ where: { settlementId } });
        await tx.settlement.update({
          where: { id: settlementId },
          data: {
            townHallLevel: INITIAL.townHallLevel,
            food: INITIAL.food,
            wood: INITIAL.wood,
            stone: INITIAL.stone,
            welfare: INITIAL.welfare,
            population: INITIAL.population,
            growthProgress: 0,
            famineProgress: 0,
            lastTick: new Date(),
            buildings: {
              create: INITIAL.buildings.map((b) => ({
                type: b.type,
                level: b.level,
                workers: b.workers,
              })),
            },
          },
        });
      });
      return {};
    }
    default:
      throw new AdminOpError(`Operación desconocida: ${op}`);
  }
}
