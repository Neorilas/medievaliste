// ============================================================================
// map.ts — vista del mapa 2D abstracto de una región (CAMBIO 4).
//
// Muestra el asentamiento propio, los de otros jugadores de la misma región y
// los neutrales (NPC). Privacidad: de los demás solo se expone nombre, nivel y
// posición; NUNCA datos de producción ni recursos.
// ============================================================================

import { Region } from "./generated/prisma/enums";
import { REGIONS } from "./regionConfig";
import { ensureRegionNeutrals } from "./neutralSettlements";

export interface MapMarker {
  name: string;
  level: number; // nivel de Ayuntamiento (jugadores) o nivel del neutral
  posX: number;
  posY: number;
}

export interface RegionMapView {
  region: Region;
  regionName: string;
  regionColor: string;
  self: (MapMarker & { id: string }) | null;
  players: MapMarker[]; // otros jugadores de la región
  neutrals: MapMarker[];
}

/**
 * Arma el mapa de la región del asentamiento dado. Devuelve null si el
 * asentamiento aún no tiene región (onboarding pendiente).
 */
export async function getRegionMap(settlementId: string): Promise<RegionMapView | null> {
  const { prisma } = await import("./prisma");

  const me = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { id: true, name: true, townHallLevel: true, region: true, posX: true, posY: true },
  });
  if (!me.region) return null;
  const region = me.region;

  // Idempotente: garantiza que la región tenga su tablero de neutrales.
  await ensureRegionNeutrals(region);

  const [others, neutrals] = await Promise.all([
    prisma.settlement.findMany({
      where: { region, id: { not: settlementId }, posX: { not: null }, posY: { not: null } },
      select: { name: true, townHallLevel: true, posX: true, posY: true },
    }),
    prisma.neutralSettlement.findMany({
      where: { region },
      select: { name: true, level: true, posX: true, posY: true },
    }),
  ]);

  return {
    region,
    regionName: REGIONS[region].name,
    regionColor: REGIONS[region].color,
    self:
      me.posX !== null && me.posY !== null
        ? { id: me.id, name: me.name, level: me.townHallLevel, posX: me.posX, posY: me.posY }
        : null,
    players: others.map((o) => ({
      name: o.name,
      level: o.townHallLevel,
      posX: o.posX!,
      posY: o.posY!,
    })),
    neutrals: neutrals.map((n) => ({
      name: n.name,
      level: n.level,
      posX: n.posX,
      posY: n.posY,
    })),
  };
}
