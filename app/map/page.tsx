"use client";

// Vista del mapa de la región (CAMBIO 4). Carga /api/map y pinta el tablero.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RegionBoard } from "@/components/RegionBoard";
import type { RegionMapView } from "@/lib/map";

export default function MapPage() {
  const router = useRouter();
  const [map, setMap] = useState<RegionMapView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/map")
      .then(async (r) => {
        const data = await r.json();
        if (!active) return;
        if (r.status === 409) {
          router.replace("/onboarding"); // sin región aún
          return;
        }
        if (!r.ok) throw new Error(data.error ?? "Error al cargar el mapa.");
        setMap(data.map);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Error"));
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 bg-zinc-950 px-4 py-5 text-zinc-100">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Mapa de la región</h1>
          {map && <span className="text-sm text-zinc-400">{map.regionName}</span>}
        </div>
        <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Volver
        </Link>
      </header>

      {error && <p className="rounded-md bg-rose-950/60 px-3 py-2 text-sm text-rose-300">⚠️ {error}</p>}

      {!map && !error && <p className="text-zinc-400">Cargando mapa…</p>}

      {map && <RegionBoard map={map} />}
    </main>
  );
}
