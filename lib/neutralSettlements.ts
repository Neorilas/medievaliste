// ============================================================================
// neutralSettlements.ts — generación PROCEDURAL y determinista de los
// asentamientos neutrales (NPC) de cada región.
//
// Determinista: misma región → mismas posiciones, nombres y niveles SIEMPRE
// (seed derivada del nombre de la región). Así el tablero es reproducible y la
// siembra en DB es idempotente: si la región ya tiene neutrales, no se recrean.
//
// Las posiciones viven en el tablero 2D abstracto (0–100 en ambos ejes).
// ============================================================================

import { Region } from "./generated/prisma/enums";
import { REGIONS } from "./regionConfig";

// --- PRNG determinista (mulberry32) sembrado con un hash de cadena (xfnv1a). ---
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Topónimos de aire romano/hispano para los neutrales. Si una región necesita
// más nombres que los del pool, se reutilizan con sufijo (Minor/Maior/Nova…).
const NAME_POOL = [
  "Pagus Albus",
  "Castrum Vetus",
  "Vicus Aquae",
  "Mons Niger",
  "Villa Ferrea",
  "Portus Magnus",
  "Lacus Frigidus",
  "Saltus Longus",
  "Fons Clara",
  "Turris Alta",
  "Campus Latus",
  "Silva Densa",
  "Ripa Aurea",
  "Vallis Profunda",
  "Collis Ventosus",
  "Ara Sacra",
  "Pons Antiquus",
  "Limes Ultimus",
];

const NAME_SUFFIXES = ["Minor", "Maior", "Nova", "Vetera", "Secunda"];

export interface GeneratedNeutral {
  name: string;
  level: number;
  posX: number;
  posY: number;
}

/**
 * Genera (sin tocar DB) los neutrales de una región de forma determinista.
 * Posiciones repartidas con separación mínima razonable dentro de [8, 92].
 */
export function generateNeutrals(region: Region): GeneratedNeutral[] {
  const count = REGIONS[region].neutralCount;
  const rng = mulberry32(hashSeed(`neutral:${region}`));
  const out: GeneratedNeutral[] = [];
  const MIN_DIST = 14; // separación mínima entre neutrales

  for (let i = 0; i < count; i++) {
    // Nombre determinista, único dentro de la región.
    const base = NAME_POOL[i % NAME_POOL.length];
    const name =
      i < NAME_POOL.length
        ? base
        : `${base} ${NAME_SUFFIXES[Math.floor(i / NAME_POOL.length) - 1] ?? `${Math.floor(i / NAME_POOL.length)}`}`;

    // Posición con unos cuantos intentos de evitar solapamientos.
    let posX = 0;
    let posY = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      posX = 8 + rng() * 84;
      posY = 8 + rng() * 84;
      const tooClose = out.some(
        (n) => Math.hypot(n.posX - posX, n.posY - posY) < MIN_DIST,
      );
      if (!tooClose) break;
    }

    const level = 1 + Math.floor(rng() * 3); // 1–3
    out.push({
      name,
      level,
      posX: Math.round(posX * 10) / 10,
      posY: Math.round(posY * 10) / 10,
    });
  }

  return out;
}

/**
 * Asegura que la región tiene sus neutrales en DB (idempotente). Se llama al
 * fijar la región de un jugador y al cargar el mapa.
 */
export async function ensureRegionNeutrals(region: Region): Promise<void> {
  const { prisma } = await import("./prisma");

  const existing = await prisma.neutralSettlement.count({ where: { region } });
  if (existing > 0) return;

  const neutrals = generateNeutrals(region);
  // createMany con skipDuplicates por si dos peticiones siembran a la vez.
  await prisma.neutralSettlement.createMany({
    data: neutrals.map((n) => ({ region, ...n })),
    skipDuplicates: true,
  });
}

/**
 * Genera una posición de partida para el asentamiento de un jugador en su región,
 * intentando no caer encima de un neutral. Determinista por settlementId.
 */
export function generatePlayerPosition(
  settlementId: string,
  neutrals: { posX: number; posY: number }[],
): { posX: number; posY: number } {
  const rng = mulberry32(hashSeed(`player:${settlementId}`));
  let posX = 50;
  let posY = 50;
  for (let attempt = 0; attempt < 40; attempt++) {
    posX = 8 + rng() * 84;
    posY = 8 + rng() * 84;
    const tooClose = neutrals.some(
      (n) => Math.hypot(n.posX - posX, n.posY - posY) < 12,
    );
    if (!tooClose) break;
  }
  return { posX: Math.round(posX * 10) / 10, posY: Math.round(posY * 10) / 10 };
}
