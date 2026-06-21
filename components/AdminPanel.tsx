"use client";

// Panel de admin: lista todos los asentamientos y permite acciones de debug para
// calibrar el balance jugando (dar recursos, fijar población/bienestar, resolver,
// lanzar plaga, resetear). Protegido en el servidor por ADMIN_EMAILS.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AdminBuilding {
  id: string;
  type: string;
  level: number;
  workers: number;
}
interface AdminEvent {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: string;
  seen: boolean;
}
interface AdminSettlement {
  id: string;
  name: string;
  email: string;
  townHallLevel: number;
  food: number;
  wood: number;
  stone: number;
  welfare: number;
  population: number;
  growthProgress: number;
  famineProgress: number;
  lastTick: string;
  buildings: AdminBuilding[];
  events: AdminEvent[];
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function AdminPanel() {
  const [settlements, setSettlements] = useState<AdminSettlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settlements");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar");
      setSettlements(data.settlements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, []);

  useEffect(() => {
    // Carga inicial al montar (fetch asíncrono; el setState ocurre tras la promesa).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const op = useCallback(
    async (settlementId: string, op: string, payload?: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/op", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ settlementId, op, payload }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 bg-zinc-950 px-4 py-6 text-zinc-100">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Panel de admin</h1>
        <div className="flex items-center gap-3 text-sm">
          <button onClick={load} className="text-zinc-400 hover:text-zinc-200">Refrescar</button>
          <Link href="/" className="text-indigo-400 hover:underline">← Al juego</Link>
        </div>
      </header>

      {error && <p className="mb-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-300">⚠️ {error}</p>}

      <p className="mb-4 text-sm text-zinc-500">{settlements.length} asentamiento(s)</p>

      <div className="flex flex-col gap-4">
        {settlements.map((s) => (
          <SettlementCard key={s.id} s={s} busy={busy} op={op} />
        ))}
      </div>
    </main>
  );
}

function SettlementCard({
  s,
  busy,
  op,
}: {
  s: AdminSettlement;
  busy: boolean;
  op: (id: string, op: string, payload?: Record<string, unknown>) => void;
}) {
  const [food, setFood] = useState("");
  const [wood, setWood] = useState("");
  const [stone, setStone] = useState("");
  const [pop, setPop] = useState(String(s.population));
  const [welfare, setWelfare] = useState(String(Math.round(s.welfare)));

  const numOr0 = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="font-medium">{s.name}</span>{" "}
          <span className="text-sm text-zinc-400">· {s.email}</span>
        </div>
        <span className="text-xs text-zinc-500">tick {ago(s.lastTick)}</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        <Stat label="🏛️ TH" value={s.townHallLevel} />
        <Stat label="🍞" value={Math.floor(s.food)} />
        <Stat label="🪵" value={Math.floor(s.wood)} />
        <Stat label="🪨" value={Math.floor(s.stone)} />
        <Stat label="😊" value={`${Math.round(s.welfare)}%`} />
        <Stat label="👥" value={s.population} />
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        Edificios: {s.buildings.map((b) => `${b.type}L${b.level}(${b.workers})`).join(", ") || "—"}
      </div>
      {s.events.length > 0 && (
        <div className="mt-1 text-xs text-zinc-500">
          Últimos eventos: {s.events.map((e) => e.type).join(", ")}
        </div>
      )}

      {/* Controles de debug */}
      <div className="mt-3 flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Field label="🍞" value={food} onChange={setFood} />
          <Field label="🪵" value={wood} onChange={setWood} />
          <Field label="🪨" value={stone} onChange={setStone} />
          <Btn
            disabled={busy}
            onClick={() => op(s.id, "addResources", { food: numOr0(food), wood: numOr0(wood), stone: numOr0(stone) })}
          >
            Sumar recursos
          </Btn>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Field label="👥" value={pop} onChange={setPop} />
          <Btn disabled={busy} onClick={() => op(s.id, "setPopulation", { population: Number(pop) })}>
            Fijar pob.
          </Btn>
          <Field label="😊" value={welfare} onChange={setWelfare} />
          <Btn disabled={busy} onClick={() => op(s.id, "setWelfare", { welfare: Number(welfare) })}>
            Fijar bienestar
          </Btn>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn disabled={busy} onClick={() => op(s.id, "resolve")}>Resolver ahora</Btn>
          <Btn disabled={busy} onClick={() => op(s.id, "plague", { hours: 6 })}>Lanzar plaga 6h</Btn>
          <Btn
            disabled={busy}
            danger
            onClick={() => {
              if (confirm(`¿Resetear "${s.name}" al estado inicial?`)) op(s.id, "reset");
            }}
          >
            Reset
          </Btn>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-zinc-800/60 px-2 py-1">
      <span className="text-zinc-400">{label}</span> <span className="font-medium">{value}</span>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-indigo-500"
      />
    </label>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1 text-sm font-medium disabled:opacity-40 ${
        danger ? "bg-rose-700 hover:bg-rose-600" : "bg-zinc-700 hover:bg-zinc-600"
      }`}
    >
      {children}
    </button>
  );
}
