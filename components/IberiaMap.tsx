"use client";

// Mapa SVG estilizado de la Hispania romana para elegir región (CAMBIO 3).
// No es geográficamente exacto: formas reconocibles y aproximadas (§ del diseño).
// Cada región es un área clicable con su color; resalta hover y seleccionada.

import { Region } from "@/lib/generated/prisma/enums";
import { REGIONS } from "@/lib/regionConfig";

// Geometría aproximada de la península (viewBox 0 0 1000 800). Solo formas.
const MAINLAND_PATHS: Partial<Record<Region, string>> = {
  [Region.GALLAECIA]: "M150,235 L300,200 L340,310 L195,330 Z",
  [Region.CANTABRIA_ET_ASTURES]: "M300,200 L470,170 L480,300 L340,310 Z",
  [Region.TARRACONENSIS]: "M470,170 L700,205 L745,330 L590,315 L480,300 Z",
  [Region.CAESARAUGUSTA]: "M480,300 L590,315 L575,455 L465,445 Z",
  [Region.CELTIBERIA]: "M340,310 L480,300 L465,445 L350,445 Z",
  [Region.LUSITANIA]: "M195,330 L340,310 L350,445 L290,580 L225,460 Z",
  [Region.CARTHAGINENSIS]: "M590,315 L745,330 L705,470 L650,565 L560,545 L575,455 Z",
  [Region.BAETICA]: "M350,445 L575,455 L560,545 L650,565 L515,625 L380,635 L290,580 Z",
};

// Anclas para la etiqueta de cada región del continente.
const LABEL_POS: Partial<Record<Region, [number, number]>> = {
  [Region.GALLAECIA]: [245, 272],
  [Region.CANTABRIA_ET_ASTURES]: [390, 248],
  [Region.TARRACONENSIS]: [605, 250],
  [Region.CAESARAUGUSTA]: [523, 380],
  [Region.CELTIBERIA]: [408, 378],
  [Region.LUSITANIA]: [278, 430],
  [Region.CARTHAGINENSIS]: [648, 430],
  [Region.BAETICA]: [468, 545],
};

export function IberiaMap({
  selected,
  onSelect,
}: {
  selected: Region | null;
  onSelect: (r: Region) => void;
}) {
  function regionProps(r: Region) {
    const info = REGIONS[r];
    const isSel = selected === r;
    return {
      fill: info.color,
      fillOpacity: isSel ? 0.95 : 0.45,
      stroke: isSel ? "#fff" : "#0a0a0a",
      strokeWidth: isSel ? 3 : 1.5,
      className: "cursor-pointer transition-all hover:fill-opacity-80",
      role: "button" as const,
      "aria-label": info.name,
      tabIndex: 0,
      onClick: () => onSelect(r),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(r);
        }
      },
    };
  }

  return (
    <svg
      viewBox="0 0 1000 800"
      className="w-full"
      style={{ touchAction: "manipulation" }}
      aria-label="Mapa de la Hispania romana"
    >
      {/* Mar de fondo */}
      <rect x="0" y="0" width="1000" height="800" fill="#0c1424" />

      {/* Regiones continentales */}
      {Object.entries(MAINLAND_PATHS).map(([key, d]) => {
        const r = key as Region;
        const [lx, ly] = LABEL_POS[r] ?? [0, 0];
        return (
          <g key={r}>
            <path d={d} {...regionProps(r)} />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              className="pointer-events-none select-none"
              fontSize="15"
              fontWeight={selected === r ? 700 : 500}
              fill="#f4f4f5"
            >
              {REGIONS[r].name}
            </text>
          </g>
        );
      })}

      {/* Insulae Baleares (este, en el mar) */}
      <g {...regionProps(Region.INSULAE_BALEARES)}>
        <ellipse cx="850" cy="375" rx="26" ry="16" />
        <ellipse cx="905" cy="360" rx="14" ry="10" />
        <ellipse cx="892" cy="402" rx="10" ry="8" />
        <ellipse cx="822" cy="398" rx="8" ry="6" />
      </g>
      <text
        x="862"
        y="438"
        textAnchor="middle"
        className="pointer-events-none select-none"
        fontSize="14"
        fontWeight={selected === Region.INSULAE_BALEARES ? 700 : 500}
        fill="#f4f4f5"
      >
        Baleares
      </text>

      {/* Insulae Fortunatae (Canarias): recuadro inset abajo a la izquierda */}
      <g>
        <rect
          x="120"
          y="610"
          width="230"
          height="150"
          rx="8"
          fill="#0a1120"
          stroke="#1f2937"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        <g {...regionProps(Region.INSULAE_FORTUNATAE)}>
          {/* hit area transparente para que todo el recuadro sea clicable */}
          <rect x="120" y="610" width="230" height="150" fill="#ffffff" fillOpacity={0.001} />
          <ellipse cx="180" cy="675" rx="22" ry="14" />
          <ellipse cx="230" cy="660" rx="16" ry="11" />
          <ellipse cx="270" cy="695" rx="13" ry="9" />
          <ellipse cx="300" cy="668" rx="9" ry="7" />
          <ellipse cx="155" cy="710" rx="8" ry="6" />
        </g>
        <text
          x="235"
          y="630"
          textAnchor="middle"
          className="pointer-events-none select-none"
          fontSize="13"
          fontWeight={selected === Region.INSULAE_FORTUNATAE ? 700 : 500}
          fill="#cbd5e1"
        >
          Insulae Fortunatae
        </text>
      </g>
    </svg>
  );
}
