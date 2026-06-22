"use client";

// Mapa del mundo con navegación por capas (Cambio B3):
//   Capa 1 — vista global: las 10 regiones de Hispania, con bandera en la propia.
//   Capa 2 — vista regional: el tablero 2D de la región elegida (propia o ajena).
//   Capa 3 — al pulsar el asentamiento propio se entra a su gestión (RegionBoard).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IberiaMap } from "@/components/IberiaMap";
import { RegionBoard } from "@/components/RegionBoard";
import { REGIONS } from "@/lib/regionConfig";
import type { Region } from "@/lib/generated/prisma/enums";
import type { RegionMapView } from "@/lib/map";

export default function MapPage() {
  const router = useRouter();
  const [playerRegion, setPlayerRegion] = useState<Region | null>(null);
  const [selected, setSelected] = useState<Region | null>(null); // null = vista global
  const [map, setMap] = useState<RegionMapView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carga el tablero de una región (o la del jugador si `region` es undefined).
  const loadRegion = useCallback(
    async (region?: Region) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(region ? `/api/map?region=${region}` : "/api/map");
        const data = await r.json();
        if (r.status === 409) {
          router.replace("/onboarding"); // sin región aún
          return;
        }
        if (!r.ok) throw new Error(data.error ?? "Error al cargar el mapa.");
        setMap(data.map);
        setPlayerRegion(data.map.playerRegion);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  // Al entrar: aprende la región del jugador para resaltarla en la vista global.
  // (Fetch inline para no llamar a setState de forma síncrona dentro del efecto.)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/map");
        const data = await r.json();
        if (!active) return;
        if (r.status === 409) {
          router.replace("/onboarding");
          return;
        }
        if (!r.ok) throw new Error(data.error ?? "Error al cargar el mapa.");
        setMap(data.map);
        setPlayerRegion(data.map.playerRegion);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Error");
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  function openRegion(r: Region) {
    setSelected(r);
    loadRegion(r);
  }

  function backToGlobal() {
    setSelected(null);
    setError(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 bg-zinc-950 px-4 py-5 text-zinc-100">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {selected ? REGIONS[selected].name : "Mapa de Hispania"}
          </h1>
          <span className="text-sm text-zinc-400">
            {selected
              ? selected === playerRegion
                ? "Tu región"
                : "Región ajena"
              : "Vista global del mundo"}
          </span>
        </div>
        {selected ? (
          <button onClick={backToGlobal} className="text-sm text-indigo-400 hover:text-indigo-300">
            ← Mundo
          </button>
        ) : (
          <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300">
            ← Volver
          </Link>
        )}
      </header>

      {error && <p className="rounded-md bg-rose-950/60 px-3 py-2 text-sm text-rose-300">⚠️ {error}</p>}

      {/* Capa 1 — vista global */}
      {!selected && (
        <>
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0c1424]">
            <IberiaMap selected={null} onSelect={openRegion} homeRegion={playerRegion} />
          </div>
          <p className="text-xs text-zinc-500">
            🚩 Tu región: <span className="text-zinc-300">{playerRegion ? REGIONS[playerRegion].name : "…"}</span>
            <br />
            Toca cualquier región para explorar sus asentamientos.
          </p>
        </>
      )}

      {/* Capa 2 — vista regional */}
      {selected && (
        <>
          {loading && <p className="text-zinc-400">Cargando región…</p>}
          {!loading && map && map.region === selected && (
            <RegionBoard map={map} onChanged={() => loadRegion(selected)} />
          )}
        </>
      )}
    </main>
  );
}
