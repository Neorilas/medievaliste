"use client";

// Interfaz del juego (cliente). SOLO muestra estado y envía acciones: no calcula
// recursos ni decide qué es legal (eso es del servidor). Hasta que exista Auth.js,
// opera sobre el jugador "dev" fijo del backend.
//
// NOTA: el diseño prevé que page.tsx sea la entrada/InstallPrompt y que el juego
// viva en /(game). Mientras no haya login ni landing, el juego vive aquí directo.

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import type {
  BuildOption,
  BuildingView,
  SettlementView,
  TownHallUpgrade,
} from "@/lib/settlement";
import type { ResolveSummary } from "@/lib/resolveSettlement";

interface PlayerInfo {
  email?: string | null;
  name?: string | null;
  isAdmin?: boolean;
}

// --- Etiquetas e iconos (clave = string del enum BuildingType) ---
const BUILDING_LABEL: Record<string, string> = {
  TOWN_HALL: "Ayuntamiento",
  FARM: "Granja",
  SAWMILL: "Serrería",
  QUARRY: "Cantera",
  HOUSE: "Casa",
  WAREHOUSE: "Almacén",
  PLAZA: "Plaza",
};
const BUILDING_ICON: Record<string, string> = {
  TOWN_HALL: "🏛️",
  FARM: "🌾",
  SAWMILL: "🪚",
  QUARRY: "⛏️",
  HOUSE: "🏠",
  WAREHOUSE: "📦",
  PLAZA: "⛲",
};
const RESOURCE_ICON: Record<string, string> = {
  food: "🍞",
  wood: "🪵",
  stone: "🪨",
  welfare: "😊",
};

type Cost = Partial<Record<"food" | "wood" | "stone", number>>;
type ActionBody =
  | { kind: "assign"; buildingId: string; workers: number }
  | { kind: "build"; buildingType: string }
  | { kind: "upgrade"; buildingId: string }
  | { kind: "upgradeTownHall" };

function fmt(n: number): string {
  return Math.floor(n).toLocaleString("es-ES");
}

// Formatea una duración en segundos de forma compacta: "45s", "3m", "1h 20m".
function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function CostTag({ cost }: { cost: Cost }) {
  const parts = (["wood", "stone", "food"] as const)
    .filter((k) => (cost[k] ?? 0) > 0)
    .map((k) => `${RESOURCE_ICON[k]} ${cost[k]}`);
  if (parts.length === 0) return null;
  return <span className="text-xs text-zinc-400">{parts.join("  ")}</span>;
}

export default function Game() {
  const [view, setView] = useState<SettlementView | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [summary, setSummary] = useState<ResolveSummary | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Carga el estado del asentamiento (resuelve el cálculo diferido en el servidor).
  // `showAway` controla si se muestra el resumen de "mientras no estabas" (solo al
  // entrar, no en los refrescos automáticos al terminar una obra).
  const load = useCallback(async (showAway: boolean) => {
    const res = await fetch("/api/settlement");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Error al cargar");
    setView(data.settlement);
    setPlayer(data.player ?? null);
    if (showAway && isNotableSummary(data.summary)) {
      setSummary(data.summary);
      setShowSummary(true);
    }
  }, []);

  // Carga inicial.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await load(true);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Error al cargar");
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  // Cuenta atrás: refresca el reloj cada segundo mientras haya alguna obra en curso.
  const hasConstruction = !!view?.buildings.some((b) => b.construction);
  useEffect(() => {
    if (!hasConstruction) return;
    const i = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(i);
  }, [hasConstruction]);

  // Cuando la obra más próxima termina, vuelve a pedir el estado al servidor (que
  // la completa) para reflejar el edificio ya terminado y produciendo.
  useEffect(() => {
    if (!view) return;
    const ends = view.buildings
      .map((b) => b.construction?.endsAt)
      .filter((x): x is string => !!x)
      .map((iso) => new Date(iso).getTime());
    if (ends.length === 0) return;
    const delay = Math.max(0, Math.min(...ends) - Date.now()) + 600;
    const t = setTimeout(() => {
      load(false).catch(() => {});
    }, delay);
    return () => clearTimeout(t);
  }, [view, load]);

  const dispatch = useCallback(async (action: ActionBody) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Acción no válida");
      setView(data.settlement);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, []);

  if (error && !view) {
    return (
      <main className="flex flex-1 items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <div className="text-center">
          <p className="mb-2 text-rose-400">⚠️ {error}</p>
          <p className="text-sm text-zinc-500">¿Está la base de datos levantada?</p>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-400">
        Cargando asentamiento…
      </main>
    );
  }

  const { resources, population, rates, welfare } = view;
  const welfareDanger = welfare < 70;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 bg-zinc-950 px-4 py-5 text-zinc-100">
      {/* Cabecera */}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{view.name}</h1>
          <span className="text-sm text-zinc-400">
            {BUILDING_ICON.TOWN_HALL} Ayuntamiento N{view.townHallLevel}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          {player?.email && <span className="text-xs text-zinc-500">{player.name ?? player.email}</span>}
          <div className="flex items-center gap-3">
            {player?.isAdmin && (
              <Link href="/admin" className="text-xs text-amber-400 hover:text-amber-300">Admin</Link>
            )}
            <button
              onClick={() => signOut({ redirectTo: "/login" })}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Resumen "mientras no estabas" */}
      {showSummary && summary && (
        <AwaySummary summary={summary} onClose={() => setShowSummary(false)} />
      )}

      {/* Recursos */}
      <section className="grid grid-cols-2 gap-2">
        <ResourceCard icon={RESOURCE_ICON.food} label="Comida" value={resources.food} cap={resources.cap} rate={rates.food} />
        <ResourceCard icon={RESOURCE_ICON.wood} label="Madera" value={resources.wood} cap={resources.cap} rate={rates.wood} />
        <ResourceCard icon={RESOURCE_ICON.stone} label="Piedra" value={resources.stone} cap={resources.cap} rate={rates.stone} />
        <div className={`rounded-lg border p-3 ${welfareDanger ? "border-rose-700 bg-rose-950/40" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="flex items-center justify-between text-sm">
            <span>{RESOURCE_ICON.welfare} Bienestar</span>
          </div>
          <div className={`mt-1 text-lg font-semibold ${welfareDanger ? "text-rose-300" : ""}`}>
            {welfare.toFixed(0)}%
          </div>
          {welfareDanger && <div className="text-xs text-rose-400">⚠️ Zona de hambruna (&lt;70%)</div>}
        </div>
      </section>

      {/* Población */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">👥 Población</span>
          <span className="font-semibold">
            {population.total} / {population.capacity}
          </span>
        </div>
        <div className="mt-1 text-xs text-zinc-400">
          {population.free} colono{population.free === 1 ? "" : "s"} libre{population.free === 1 ? "" : "s"} · comen {fmt(rates.foodConsumption)} comida/h
        </div>
      </section>

      {error && view && (
        <p className="rounded-md bg-rose-950/60 px-3 py-2 text-sm text-rose-300">⚠️ {error}</p>
      )}

      {/* Edificios (el Ayuntamiento tiene su propia tarjeta más abajo) */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-400">Edificios</h2>
        {view.buildings
          .filter((b) => b.type !== "TOWN_HALL")
          .map((b) => (
            <BuildingCard
              key={b.id}
              b={b}
              freeColonists={population.free}
              busy={busy}
              nowMs={nowMs}
              onAssign={(workers) => dispatch({ kind: "assign", buildingId: b.id, workers })}
              onUpgrade={() => dispatch({ kind: "upgrade", buildingId: b.id })}
            />
          ))}
      </section>

      {/* Subir Ayuntamiento */}
      <TownHallCard
        th={view.townHallUpgrade}
        level={view.townHallLevel}
        busy={busy}
        nowMs={nowMs}
        construction={view.buildings.find((b) => b.type === "TOWN_HALL")?.construction ?? null}
        onUpgrade={() => dispatch({ kind: "upgradeTownHall" })}
      />

      {/* Construir */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-400">
          Construir <span className="text-zinc-600">({view.buildings.length}/{view.maxBuildings})</span>
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {view.buildOptions.map((o) => (
            <BuildOptionButton key={o.type} o={o} busy={busy} onBuild={() => dispatch({ kind: "build", buildingType: o.type })} />
          ))}
        </div>
      </section>
    </main>
  );
}

function ResourceCard({ icon, label, value, cap, rate }: { icon: string; label: string; value: number; cap: number; rate: number }) {
  const full = value >= cap;
  const rateStr = rate > 0 ? `+${rate}` : `${rate}`;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between text-sm">
        <span>{icon} {label}</span>
        <span className={rate > 0 ? "text-emerald-400 text-xs" : rate < 0 ? "text-rose-400 text-xs" : "text-zinc-500 text-xs"}>
          {rateStr}/h
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold">
        {fmt(value)} <span className={`text-xs font-normal ${full ? "text-amber-400" : "text-zinc-500"}`}>/ {fmt(cap)}{full ? " lleno" : ""}</span>
      </div>
    </div>
  );
}

// Barra de progreso de una obra en curso, con cuenta atrás del tiempo restante.
function ConstructionBar({
  construction,
  nowMs,
  label,
}: {
  construction: NonNullable<BuildingView["construction"]>;
  nowMs: number;
  label: string;
}) {
  const endMs = new Date(construction.endsAt).getTime();
  const remainingSec = Math.max(0, (endMs - nowMs) / 1000);
  const total = construction.totalSeconds;
  const progress = total > 0 ? Math.min(1, Math.max(0, (total - remainingSec) / total)) : 1;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-amber-300">
        <span>🏗️ {label}</span>
        <span className="tabular-nums">
          {remainingSec > 0 ? `queda ${fmtDuration(remainingSec)}` : "terminando…"}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
        <div
          className="h-full rounded bg-amber-500 transition-all duration-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function BuildingCard({
  b,
  freeColonists,
  busy,
  nowMs,
  onAssign,
  onUpgrade,
}: {
  b: BuildingView;
  freeColonists: number;
  busy: boolean;
  nowMs: number;
  onAssign: (workers: number) => void;
  onUpgrade: () => void;
}) {
  const isProducer = b.produces !== null;
  const isNew = b.level === 0; // construcción inicial (aún no funcional)
  const showWorkers = isProducer && !isNew;
  const canAddWorker = showWorkers && b.workers < b.maxWorkers && freeColonists > 0;
  const canRemoveWorker = showWorkers && b.workers > 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {BUILDING_ICON[b.type]} {BUILDING_LABEL[b.type]}{" "}
          {isNew ? (
            <span className="text-xs text-amber-400">en construcción</span>
          ) : (
            <span className="text-xs text-zinc-500">N{b.level}</span>
          )}
        </span>
        {isProducer && !isNew && (
          <span className="text-xs text-emerald-400">+{b.productionPerHour} {RESOURCE_ICON[b.produces!]}/h</span>
        )}
      </div>

      {/* Asignar colonos */}
      {showWorkers && (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-xs text-zinc-400">Colonos</span>
          <button
            disabled={busy || !canRemoveWorker}
            onClick={() => onAssign(b.workers - 1)}
            className="h-7 w-7 rounded bg-zinc-800 text-lg leading-none disabled:opacity-30"
            aria-label="Quitar colono"
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums">{b.workers}/{b.maxWorkers}</span>
          <button
            disabled={busy || !canAddWorker}
            onClick={() => onAssign(b.workers + 1)}
            className="h-7 w-7 rounded bg-zinc-800 text-lg leading-none disabled:opacity-30"
            aria-label="Añadir colono"
          >
            +
          </button>
        </div>
      )}

      {/* Obra en curso */}
      {b.construction && (
        <ConstructionBar
          construction={b.construction}
          nowMs={nowMs}
          label={isNew ? "Construyendo" : `Mejorando a N${b.construction.toLevel}`}
        />
      )}

      {/* Mejorar (oculto mientras hay obra en curso) */}
      {b.upgrade && !b.construction && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <CostTag cost={b.upgrade.cost} />
          <button
            disabled={busy || !b.upgrade.canUpgrade}
            onClick={onUpgrade}
            title={b.upgrade.canUpgrade ? `Tarda ${fmtDuration(b.upgrade.durationSeconds)}` : b.upgrade.reason}
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            Mejorar a N{b.level + 1} · ⏱ {fmtDuration(b.upgrade.durationSeconds)}
          </button>
        </div>
      )}
    </div>
  );
}

function TownHallCard({
  th,
  level,
  busy,
  nowMs,
  construction,
  onUpgrade,
}: {
  th: TownHallUpgrade;
  level: number;
  busy: boolean;
  nowMs: number;
  construction: BuildingView["construction"];
  onUpgrade: () => void;
}) {
  return (
    <section className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{BUILDING_ICON.TOWN_HALL} Ayuntamiento N{level}</span>
        {th.atMax ? (
          <span className="text-xs text-zinc-500">Nivel máximo</span>
        ) : (
          !construction && (
            <div className="flex items-center gap-2">
              <CostTag cost={th.cost} />
              <button
                disabled={busy || !th.canUpgrade}
                onClick={onUpgrade}
                title={th.canUpgrade ? `Tarda ${fmtDuration(th.durationSeconds)}` : th.reason}
                className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-black disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                Subir a N{level + 1} · ⏱ {fmtDuration(th.durationSeconds)}
              </button>
            </div>
          )
        )}
      </div>
      {construction && (
        <ConstructionBar construction={construction} nowMs={nowMs} label={`Mejorando a N${construction.toLevel}`} />
      )}
      <p className="mt-1 text-xs text-zinc-400">Sube el techo de edificios y de nivel. La progresión del asentamiento.</p>
    </section>
  );
}

function BuildOptionButton({ o, busy, onBuild }: { o: BuildOption; busy: boolean; onBuild: () => void }) {
  return (
    <button
      disabled={busy || !o.canBuild}
      onClick={onBuild}
      title={o.canBuild ? `Tarda ${fmtDuration(o.durationSeconds)}` : o.reason}
      className="flex flex-col items-start gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left disabled:opacity-40"
    >
      <span className="text-sm font-medium">
        {BUILDING_ICON[o.type]} {BUILDING_LABEL[o.type]}
      </span>
      <div className="flex w-full items-center justify-between gap-2">
        <CostTag cost={o.cost} />
        <span className="text-xs text-amber-400/80">⏱ {fmtDuration(o.durationSeconds)}</span>
      </div>
    </button>
  );
}

function AwaySummary({ summary, onClose }: { summary: ResolveSummary; onClose: () => void }) {
  const lines: string[] = [];
  if (summary.food > 0.5) lines.push(`+${fmt(summary.food)} 🍞`);
  if (summary.wood > 0.5) lines.push(`+${fmt(summary.wood)} 🪵`);
  if (summary.stone > 0.5) lines.push(`+${fmt(summary.stone)} 🪨`);
  if (summary.colonistsArrived > 0) lines.push(`👶 llegó ${summary.colonistsArrived} colono${summary.colonistsArrived === 1 ? "" : "s"}`);
  if (summary.colonistsLost > 0) lines.push(`💀 perdiste ${summary.colonistsLost} colono${summary.colonistsLost === 1 ? "" : "s"}`);
  if (summary.buildingsCompleted > 0) lines.push(`🏗️ ${summary.buildingsCompleted} obra${summary.buildingsCompleted === 1 ? "" : "s"} terminada${summary.buildingsCompleted === 1 ? "" : "s"}`);
  if (summary.plagueActive) lines.push("🦠 hubo una plaga");

  return (
    <div className="rounded-lg border border-indigo-800 bg-indigo-950/40 p-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-200">Mientras no estabas ({Math.round(summary.elapsedHours)}h)</p>
          <p className="mt-1 text-sm text-zinc-300">{lines.length > 0 ? lines.join(" · ") : "Sin novedades."}</p>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300" aria-label="Cerrar">✕</button>
      </div>
    </div>
  );
}

// Decide si el resumen merece mostrarse (evita el banner en cada refresco trivial).
function isNotableSummary(s: ResolveSummary | undefined): boolean {
  if (!s) return false;
  return (
    s.colonistsArrived > 0 ||
    s.colonistsLost > 0 ||
    s.buildingsCompleted > 0 ||
    s.plagueActive ||
    s.food > 1 ||
    s.wood > 1 ||
    s.stone > 1
  );
}
