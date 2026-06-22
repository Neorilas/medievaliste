"use client";

// Tablero 2D abstracto de una región (CAMBIO 4). Coordenadas 0–100.
// Pinta el asentamiento propio (destacado), los de otros jugadores y los
// neutrales (NPC). En v1 solo son visibles, no interactuables.

import { useState } from "react";
import type { RegionMapView, MapMarker } from "@/lib/map";

type Kind = "self" | "player" | "neutral";

interface Placed extends MapMarker {
  kind: Kind;
}

export function RegionBoard({ map }: { map: RegionMapView }) {
  const [active, setActive] = useState<Placed | null>(null);

  const placed: Placed[] = [
    ...map.neutrals.map((n) => ({ ...n, kind: "neutral" as const })),
    ...map.players.map((p) => ({ ...p, kind: "player" as const })),
    ...(map.self ? [{ ...map.self, kind: "self" as const }] : []),
  ];

  const STYLE: Record<Kind, { fill: string; stroke: string; r: number }> = {
    self: { fill: map.regionColor, stroke: "#ffffff", r: 3.4 },
    player: { fill: "#818cf8", stroke: "#c7d2fe", r: 2.6 },
    neutral: { fill: "#71717a", stroke: "#a1a1aa", r: 2.2 },
  };

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0c1424]">
        <svg viewBox="0 0 100 100" className="w-full" style={{ touchAction: "manipulation" }}>
          {/* Rejilla sutil */}
          {[20, 40, 60, 80].map((g) => (
            <g key={g} stroke="#1e293b" strokeWidth="0.2">
              <line x1={g} y1="0" x2={g} y2="100" />
              <line x1="0" y1={g} x2="100" y2={g} />
            </g>
          ))}

          {placed.map((m, i) => {
            const st = STYLE[m.kind];
            const isActive = active === m;
            return (
              <g
                key={`${m.kind}-${i}`}
                className="cursor-pointer"
                onClick={() => setActive(isActive ? null : m)}
              >
                <circle
                  cx={m.posX}
                  cy={m.posY}
                  r={st.r + (isActive ? 1 : 0)}
                  fill={st.fill}
                  stroke={st.stroke}
                  strokeWidth={m.kind === "self" ? 0.8 : 0.5}
                />
                {m.kind === "self" && (
                  <circle
                    cx={m.posX}
                    cy={m.posY}
                    r={st.r + 2}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="0.4"
                    strokeDasharray="1 1"
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Leyenda */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        <Legend color={map.regionColor} label="Tu asentamiento" ring />
        <Legend color="#818cf8" label={`Otros jugadores (${map.players.length})`} />
        <Legend color="#71717a" label={`Neutrales (${map.neutrals.length})`} />
      </div>

      {/* Detalle del marcador activo */}
      {active && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {active.kind === "self" ? "🏠 " : active.kind === "player" ? "🚩 " : "⚪ "}
              {active.name}
            </span>
            <span className="text-xs text-zinc-400">
              {active.kind === "neutral" ? `Nivel ${active.level}` : `Ayuntamiento N${active.level}`}
            </span>
          </div>
          {active.kind === "neutral" && (
            <p className="mt-1 text-xs text-zinc-500">
              Asentamiento neutral. En el futuro podrás saquearlo o conquistarlo.
            </p>
          )}
          {active.kind === "player" && (
            <p className="mt-1 text-xs text-zinc-500">Otro colono de tu región.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`h-3 w-3 rounded-full ${ring ? "ring-1 ring-white" : ""}`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
