"use client";

// Modal de evento aleatorio (Bloque 4 §B.5). El cliente solo MUESTRA: el efecto y la
// legalidad los decide el servidor (lib/events.ts).
//
//   [Nombre del personaje, origen]
//   [Narrativa romana]
//   [Mecánica: "Ofrece X a cambio de Y" o "Efecto: −10 comida"]
//   [Aceptar] [Rechazar]   ← solo en los intercambios
//   [Tiempo restante: Xh]
//
// Las inclemencias no tienen personaje; la llegada de colonos no es un intercambio,
// así que solo muestran un botón de acuse ("Entendido"/"Acoger") que aplica el efecto.

import { useEffect, useState } from "react";
import type { EventView } from "@/lib/events";

const RESOURCE_ICON: Record<string, string> = { food: "🍞", wood: "🪵", stone: "🪨" };

function fmtRemaining(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function EventModal({
  event,
  resources,
  busy,
  onResolve,
}: {
  event: EventView;
  resources: { food: number; wood: number; stone: number };
  busy: boolean;
  onResolve: (action: "accept" | "decline") => void;
}) {
  // Cuenta atrás local del plazo de respuesta.
  const expiresMs = new Date(event.expiresAt).getTime();
  const [remaining, setRemaining] = useState(() => (expiresMs - Date.now()) / 1000);
  useEffect(() => {
    const i = setInterval(() => setRemaining((expiresMs - Date.now()) / 1000), 1000);
    return () => clearInterval(i);
  }, [expiresMs]);

  // ¿Puede pagar el trato? (solo afecta al botón Aceptar de los intercambios)
  let canAfford = true;
  if (event.isTrade && "give" in event.payload) {
    const give = event.payload.give;
    canAfford = (resources[give.resource] ?? 0) >= give.amount;
  }

  const accent = event.isTrade
    ? "border-amber-700"
    : event.type === "COLONIST_ARRIVAL"
      ? "border-emerald-700"
      : "border-rose-800";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className={`w-full max-w-md rounded-2xl border ${accent} bg-zinc-900 p-5 shadow-2xl`}>
        {/* Personaje (mercader / peregrino) u origen de la inclemencia */}
        {event.character ? (
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-2xl">
              {event.isTrade ? "🧔" : "🧑‍🌾"}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-zinc-100">{event.character.name}</p>
              <p className="truncate text-xs text-zinc-500">de {event.character.origin}</p>
            </div>
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-2 text-rose-300">
            <span className="text-2xl">🌩️</span>
            <span className="text-sm font-semibold uppercase tracking-wide">Inclemencia</span>
          </div>
        )}

        {/* Narrativa */}
        <p className="mt-1 text-sm italic leading-relaxed text-zinc-300">“{event.narrative}”</p>

        {/* Mecánica */}
        <div className="mt-3 rounded-lg bg-zinc-800/60 px-3 py-2.5 text-sm text-zinc-200">
          {event.isTrade && "give" in event.payload ? (
            <div className="flex items-center justify-center gap-3 font-medium tabular-nums">
              <span className="text-rose-300">
                −{event.payload.give.amount} {RESOURCE_ICON[event.payload.give.resource]}
              </span>
              <span className="text-zinc-500">→</span>
              <span className="text-emerald-300">
                +{event.payload.receive.amount} {RESOURCE_ICON[event.payload.receive.resource]}
              </span>
            </div>
          ) : (
            <p className="text-center">{event.mechanic}</p>
          )}
        </div>

        {/* Acciones */}
        {event.isTrade ? (
          <div className="mt-4 flex gap-2">
            <button
              disabled={busy || !canAfford}
              onClick={() => onResolve("accept")}
              title={canAfford ? undefined : "No tienes recursos para este trato"}
              className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Aceptar
            </button>
            <button
              disabled={busy}
              onClick={() => onResolve("decline")}
              className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={() => onResolve("accept")}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {event.type === "COLONIST_ARRIVAL" ? "Acoger" : "Entendido"}
          </button>
        )}

        {/* Tiempo restante */}
        <p className="mt-3 text-center text-xs text-zinc-500">
          {remaining > 0 ? `Tiempo restante: ${fmtRemaining(remaining)}` : "Expirando…"}
        </p>
      </div>
    </div>
  );
}
