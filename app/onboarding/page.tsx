"use client";

// Onboarding: selección de región (CAMBIO 3). Paso posterior al registro.
// La elección es PERMANENTE. Mapa SVG clicable + lista de regiones + panel de
// detalle. Al confirmar, POST /api/settlement/region y entrada al juego.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IberiaMap } from "@/components/IberiaMap";
import { REGION_LIST } from "@/lib/regionConfig";
import { Region } from "@/lib/generated/prisma/enums";

export default function OnboardingPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Region | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si ya tiene región, no debería estar aquí: al juego.
  useEffect(() => {
    let active = true;
    fetch("/api/settlement")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data?.settlement?.region) {
          router.replace("/");
        } else {
          setLoading(false);
        }
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [router]);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settlement/region", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ region: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo fijar la región.");
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-400">
        Cargando…
      </main>
    );
  }

  const info = selected ? REGION_LIST.find((r) => r.key === selected) ?? null : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 bg-zinc-950 px-4 py-6 text-zinc-100">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">Elige tu región</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Define tu mundo y con quién compartirás tablero. La elección es{" "}
          <span className="font-medium text-amber-300">permanente</span>.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0c1424]">
        <IberiaMap selected={selected} onSelect={setSelected} />
      </div>

      {/* Lista de regiones (selector fiable también en móvil) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {REGION_LIST.map((r) => (
          <button
            key={r.key}
            onClick={() => setSelected(r.key)}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${
              selected === r.key
                ? "border-white bg-zinc-800"
                : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
            }`}
          >
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: r.color }}
            />
            <span className="truncate">{r.name}</span>
          </button>
        ))}
      </div>

      {/* Panel de detalle de la región seleccionada */}
      {info ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: info.color }} />
            <h2 className="text-lg font-semibold">{info.name}</h2>
          </div>
          <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{info.territory}</p>
          <p className="mt-2 text-sm italic text-amber-300/90">«{info.lore}»</p>
          <p className="mt-2 text-sm text-zinc-300">{info.description}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">
          Toca una región en el mapa o en la lista para conocerla.
        </p>
      )}

      {error && <p className="text-center text-sm text-rose-400">⚠️ {error}</p>}

      <button
        disabled={!selected || busy}
        onClick={confirm}
        className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40"
      >
        {busy
          ? "Fundando…"
          : info
            ? `Fundar en ${info.name}`
            : "Elige una región para continuar"}
      </button>
    </main>
  );
}
