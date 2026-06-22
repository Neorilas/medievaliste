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
import { MILITARY } from "./gameConfig";

export interface MapMarker {
  name: string;
  level: number; // nivel de Ayuntamiento (jugadores) o nivel del neutral
  posX: number;
  posY: number;
}

// Relación de un jugador del mapa respecto al que mira (Bloque 6). Se expone para
// que la UI sepa qué interacción ofrecer; NUNCA se exponen recursos ni fuerza ajena.
export type MapRelation = "none" | "vassal" | "lord";

export interface PlayerMarker extends MapMarker {
  id: string; // id del asentamiento (necesario para declarar guerra)
  relation: MapRelation; // respecto al jugador que mira: ¿es mi vasallo / mi señor?
  immune: boolean; // inmunidad de novato activa (no se puede conquistar). §1.6
}

export interface RegionMapView {
  region: Region;
  regionName: string;
  regionColor: string;
  // true si es la región del propio jugador (la única con marcador "aquí estás"
  // y asentamiento propio clicable). false al explorar regiones ajenas (B3).
  isOwnRegion: boolean;
  // Región a la que pertenece el jugador (para resaltarla en la vista global).
  playerRegion: Region;
  self: (MapMarker & { id: string }) | null;
  players: PlayerMarker[]; // otros jugadores de la región
  neutrals: MapMarker[];
}

/**
 * Arma el tablero de una región (Cambio B3: cualquier región es explorable, no
 * solo la propia). Sin `regionOverride` usa la región del jugador. Devuelve null
 * si el jugador aún no tiene región (onboarding pendiente).
 *
 * El asentamiento propio y el marcador "aquí estás" solo aparecen en la región
 * del jugador; en regiones ajenas se ven los neutrales (y otros jugadores), nunca
 * datos de producción (misma política de privacidad del Cambio 4).
 */
export async function getRegionMap(
  settlementId: string,
  regionOverride?: Region,
): Promise<RegionMapView | null> {
  const { prisma } = await import("./prisma");

  const me = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      id: true,
      name: true,
      townHallLevel: true,
      region: true,
      posX: true,
      posY: true,
      // Vasallaje (Bloque 6): mi señor y mis vasallos, para marcar la relación en el mapa.
      overlord: { select: { lordId: true } },
      vassals: { select: { vassalId: true } },
    },
  });
  if (!me.region) return null;
  const region = regionOverride ?? me.region;
  const isOwnRegion = region === me.region;

  // Idempotente: garantiza que la región tenga su tablero de neutrales.
  await ensureRegionNeutrals(region);

  const myLordId = me.overlord?.lordId ?? null;
  const myVassalIds = new Set(me.vassals.map((v) => v.vassalId));

  const [others, neutrals] = await Promise.all([
    prisma.settlement.findMany({
      where: { region, id: { not: settlementId }, posX: { not: null }, posY: { not: null } },
      select: { id: true, name: true, townHallLevel: true, posX: true, posY: true, createdAt: true },
    }),
    prisma.neutralSettlement.findMany({
      where: { region },
      select: { name: true, level: true, posX: true, posY: true },
    }),
  ]);

  const now = Date.now();
  const immunityMs = MILITARY.newbieImmunityDays * 24 * 60 * 60 * 1000;

  return {
    region,
    regionName: REGIONS[region].name,
    regionColor: REGIONS[region].color,
    isOwnRegion,
    playerRegion: me.region,
    self:
      isOwnRegion && me.posX !== null && me.posY !== null
        ? { id: me.id, name: me.name, level: me.townHallLevel, posX: me.posX, posY: me.posY }
        : null,
    players: others.map((o) => {
      // La relación solo tiene sentido en la región propia (donde puedo interactuar).
      const relation: MapRelation = !isOwnRegion
        ? "none"
        : o.id === myLordId
          ? "lord"
          : myVassalIds.has(o.id)
            ? "vassal"
            : "none";
      return {
        id: o.id,
        name: o.name,
        level: o.townHallLevel,
        posX: o.posX!,
        posY: o.posY!,
        relation,
        immune: now < o.createdAt.getTime() + immunityMs,
      };
    }),
    neutrals: neutrals.map((n) => ({
      name: n.name,
      level: n.level,
      posX: n.posX,
      posY: n.posY,
    })),
  };
}
