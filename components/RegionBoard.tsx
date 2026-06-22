"use client";

// Tablero 2D abstracto de una región (CAMBIO 4 + Bloque 6). Coordenadas 0–100.
// Pinta el asentamiento propio (destacado), los de otros jugadores y los
// neutrales (NPC). Sobre otro jugador de TU región puedes declarar guerra (§1.2).

import { useState } from "react";
import Link from "next/link";
import type { RegionMapView, MapMarker, PlayerMarker } from "@/lib/map";
import type { WarResult } from "@/lib/warfare";

type Kind = "self" | "player" | "neutral";

// Marcador colocado en el tablero. Los de jugador llevan los campos extra de
// PlayerMarker (id, relación, inmunidad); los demás, solo los de MapMarker.
type Placed = (MapMarker & { kind: "self" | "neutral" }) | (PlayerMarker & { kind: "player" });

const RELATION_NOTE: Record<PlayerMarker["relation"], string | null> = {
  none: null,
  lord: "👑 Es tu señor. Puedes rebelarte desde tu asentamiento si tu fuerza lo supera.",
  vassal: "🔗 Es tu vasallo: te cede parte de su producción.",
};

export function RegionBoard({ map, onChanged }: { map: RegionMapView; onChanged?: () => void }) {
  const [active, setActive] = useState<Placed | null>(null);
  const [busy, setBusy] = useState(false);
  const [warError, setWarError] = useState<string | null>(null);
  const [warResult, setWarResult] = useState<WarResult | null>(null);

  function select(m: Placed | null) {
    setActive(m);
    setWarError(null);
    setWarResult(null);
  }

  async function declareWar(defenderId: string) {
    setBusy(true);
    setWarError(null);
    setWarResult(null);
    try {
      const r = await fetch("/api/war/declare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defenderId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "No se pudo declarar la guerra.");
      setWarResult(data.result as WarResult);
      onChanged?.(); // recargar el mapa (la relación pudo cambiar)
    } catch (e) {
      setWarError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

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
            const isVassal = m.kind === "player" && m.relation === "vassal";
            const isLord = m.kind === "player" && m.relation === "lord";
            return (
              <g
                key={`${m.kind}-${i}`}
                className="cursor-pointer"
                onClick={() => select(isActive ? null : m)}
              >
                <circle
                  cx={m.posX}
                  cy={m.posY}
                  r={st.r + (isActive ? 1 : 0)}
                  fill={isVassal ? "#34d399" : isLord ? "#f59e0b" : st.fill}
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
        {map.self && <Legend color={map.regionColor} label="Tu asentamiento" ring />}
        <Legend color="#818cf8" label={`Otros jugadores (${map.players.length})`} />
        <Legend color="#34d399" label="Tus vasallos" />
        <Legend color="#71717a" label={`Neutrales (${map.neutrals.length})`} />
      </div>
      {!map.isOwnRegion && (
        <p className="mt-2 text-xs text-zinc-500">
          🔭 Estás explorando una región ajena. Aquí no tienes asentamiento ni puedes guerrear.
        </p>
      )}

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

          {active.kind === "self" && (
            <Link
              href="/"
              className="mt-2 inline-block rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Gestionar asentamiento →
            </Link>
          )}

          {/* Interacción de guerra (solo en la región propia) */}
          {active.kind === "player" && map.isOwnRegion && (
            <div className="mt-2">
              {RELATION_NOTE[active.relation] && (
                <p className="text-xs text-zinc-400">{RELATION_NOTE[active.relation]}</p>
              )}

              {!warResult && active.relation === "none" && active.immune && (
                <p className="text-xs text-emerald-400">
                  🛡️ Protegido por la inmunidad de novato. Aún no puede ser conquistado.
                </p>
              )}

              {!warResult && active.relation === "none" && !active.immune && (
                <button
                  onClick={() => declareWar(active.id)}
                  disabled={busy}
                  className="mt-1 inline-block rounded bg-rose-700 px-3 py-1 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  {busy ? "Resolviendo…" : "⚔️ Declarar guerra"}
                </button>
              )}

              {warError && <p className="mt-2 text-xs text-rose-300">⚠️ {warError}</p>}

              {warResult && (
                <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs">
                  <p className={warResult.attackerWon ? "text-emerald-300" : "text-rose-300"}>
                    {warResult.attackerWon
                      ? `¡Victoria! ${warResult.defenderName} es ahora tu vasallo.`
                      : `Derrota. ${warResult.defenderName} resistió tu ataque.`}
                  </p>
                  <p className="mt-1 text-zinc-400">
                    Tu fuerza {warResult.attackerForce} · su fuerza {warResult.defenderForce}
                  </p>
                </div>
              )}
            </div>
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
