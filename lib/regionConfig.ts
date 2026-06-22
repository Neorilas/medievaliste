// ============================================================================
// regionConfig.ts — TODOS los textos y metadatos de las 10 regiones.
//
// Por diseño, los textos de UI (nombre en juego, lore, descripción) y el balance
// de cada región (nº de asentamientos neutrales, color) viven AQUÍ, separados de
// la lógica, para poder editarlos sin tocar componentes ni servidor.
//
// La GEOMETRÍA del mapa (paths SVG de la península) NO vive aquí: es propia del
// componente de mapa. Aquí solo van datos y texto.
// ============================================================================

import { Region } from "./generated/prisma/enums";

export interface RegionInfo {
  /** Clave del enum (sirve también de id estable). */
  key: Region;
  /** Nombre tal y como se muestra en el juego. */
  name: string;
  /** Territorio aproximado en geografía actual. */
  territory: string;
  /** Frase de ambientación corta. */
  lore: string;
  /** Descripción algo más larga para el panel de selección. */
  description: string;
  /** Color identificativo de la región (hex), legible sobre fondo oscuro. */
  color: string;
  /** Nº de asentamientos neutrales (NPC) que habitan la región. */
  neutralCount: number;
}

export const REGIONS: Record<Region, RegionInfo> = {
  [Region.GALLAECIA]: {
    key: Region.GALLAECIA,
    name: "Gallaecia",
    territory: "Galicia · Asturias · N. Portugal",
    lore: "Frontera del mundo conocido",
    description:
      "Tierra de bruma y granito en el extremo noroeste. Aislada y orgullosa, mira al océano que nadie ha cruzado.",
    color: "#4ade80", // verde atlántico
    neutralCount: 6,
  },
  [Region.CANTABRIA_ET_ASTURES]: {
    key: Region.CANTABRIA_ET_ASTURES,
    name: "Cantabria et Astures",
    territory: "Cantabria · País Vasco · Asturias interior",
    lore: "Nunca completamente conquistada",
    description:
      "Montañas indómitas del norte. Sus gentes resistieron a las legiones más tiempo que ningún otro pueblo de Hispania.",
    color: "#22d3ee", // cian montaña
    neutralCount: 5,
  },
  [Region.TARRACONENSIS]: {
    key: Region.TARRACONENSIS,
    name: "Tarraconensis",
    territory: "Cataluña · Navarra · Rioja · Aragón norte",
    lore: "La joya del Mediterráneo norte",
    description:
      "Costa próspera y capital provincial. Puerto, comercio y vino: el corazón administrativo del nordeste.",
    color: "#f472b6", // rosa mediterráneo
    neutralCount: 8,
  },
  [Region.CAESARAUGUSTA]: {
    key: Region.CAESARAUGUSTA,
    name: "Caesaraugusta",
    territory: "Aragón interior · Valle del Ebro",
    lore: "Fundada por el propio Augusto",
    description:
      "Ciudad imperial junto al gran río. El Ebro la nutre y la conecta con todo el interior peninsular.",
    color: "#fbbf24", // ámbar del Ebro
    neutralCount: 8,
  },
  [Region.CELTIBERIA]: {
    key: Region.CELTIBERIA,
    name: "Celtiberia",
    territory: "Castilla y León · meseta norte",
    lore: "Corazón guerrero de Hispania",
    description:
      "La alta meseta, fría y vasta. Cuna de guerreros celtíberos que vendieron cara cada colina.",
    color: "#a78bfa", // violeta meseta
    neutralCount: 7,
  },
  [Region.LUSITANIA]: {
    key: Region.LUSITANIA,
    name: "Lusitania",
    territory: "Portugal · Extremadura",
    lore: "Cuna de guerreros y comerciantes",
    description:
      "El occidente atlántico. Tierra de Viriato, de dehesas interminables y rutas hacia el mar abierto.",
    color: "#34d399", // verde lusitano
    neutralCount: 7,
  },
  [Region.CARTHAGINENSIS]: {
    key: Region.CARTHAGINENSIS,
    name: "Carthaginensis",
    territory: "C.-La Mancha · Valencia · Murcia",
    lore: "Plata, sal y mar",
    description:
      "El sureste minero y salinero. Cartago dejó aquí su huella antes de que Roma reclamara sus riquezas.",
    color: "#60a5fa", // azul levantino
    neutralCount: 8,
  },
  [Region.BAETICA]: {
    key: Region.BAETICA,
    name: "Baetica",
    territory: "Andalucía",
    lore: "La más rica de Hispania",
    description:
      "El sur dorado del Guadalquivir. Aceite, trigo y minas: la provincia más próspera de toda la península.",
    color: "#f59e0b", // dorado bético
    neutralCount: 9,
  },
  [Region.INSULAE_BALEARES]: {
    key: Region.INSULAE_BALEARES,
    name: "Insulae Baleares",
    territory: "Baleares",
    lore: "Señoras del Mediterráneo",
    description:
      "Islas de honderos legendarios en mitad del mar. Encrucijada de todas las rutas mediterráneas.",
    color: "#fb7185", // coral isleño
    neutralCount: 4,
  },
  [Region.INSULAE_FORTUNATAE]: {
    key: Region.INSULAE_FORTUNATAE,
    name: "Insulae Fortunatae",
    territory: "Canarias",
    lore: "El fin del mundo conocido",
    description:
      "Las islas afortunadas, en el confín del océano. Más allá no hay mapa: solo leyenda.",
    color: "#2dd4bf", // turquesa oceánico
    neutralCount: 5,
  },
};

/** Lista ordenada de regiones (orden de declaración del enum). */
export const REGION_LIST: RegionInfo[] = Object.values(Region).map((r) => REGIONS[r]);

/** Comprueba si una cadena es una región válida. */
export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && value in REGIONS;
}
