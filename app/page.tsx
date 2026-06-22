"use client";

// Interfaz del juego (cliente). SOLO muestra estado y envía acciones: no calcula
// recursos ni decide qué es legal (eso es del servidor). Hasta que exista Auth.js,
// opera sobre el jugador "dev" fijo del backend.
//
// NOTA: el diseño prevé que page.tsx sea la entrada/InstallPrompt y que el juego
// viva en /(game). Mientras no haya login ni landing, el juego vive aquí directo.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BuildOption,
  BuildingView,
  SettlementView,
  TownHallUpgrade,
} from "@/lib/settlement";
import type { StatDelta } from "@/lib/gameConfig";
import type { ResolveSummary } from "@/lib/resolveSettlement";
import type { CompletedAchievement } from "@/lib/achievements";
import type { TutorialStepId } from "@/lib/tutorial";
import {
  TutorialProvider,
  TutorialLayer,
  useTutorial,
  useTutorialAnchor,
} from "@/components/Tutorial";
import { AchievementsPanel } from "@/components/AchievementsPanel";
import { ToastStack, type Toast } from "@/components/GameToasts";
import { EventModal } from "@/components/EventModal";
import type { EventView } from "@/lib/events";

interface PlayerInfo {
  email?: string | null;
  name?: string | null;
  username?: string | null;
  isAdmin?: boolean;
}

/** Nombre visible del jugador: name, si no username, si no la parte local del email. */
function displayPlayerName(player: PlayerInfo): string {
  return player.name ?? player.username ?? player.email?.split("@")[0] ?? "Jugador";
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
type Held = { food: number; wood: number; stone: number };
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

// Coste de una acción mostrado como `actual/necesario 🪵` (Cambio B1). Se muestran
// TODOS los recursos requeridos; los que el jugador no alcanza salen en rojo.
function ResourceCost({ cost, have }: { cost: Cost; have: Held }) {
  const keys = (["wood", "stone", "food"] as const).filter((k) => (cost[k] ?? 0) > 0);
  if (keys.length === 0) return <span className="text-xs text-zinc-500">Gratis</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {keys.map((k) => {
        const need = cost[k]!;
        const cur = Math.floor(have[k]);
        const enough = cur >= need;
        return (
          <span
            key={k}
            className={`text-xs tabular-nums ${enough ? "text-emerald-400" : "text-rose-400"}`}
            title={enough ? "Recurso cubierto" : `Te faltan ${need - cur} ${RESOURCE_ICON[k]}`}
          >
            {cur}/{need} {RESOURCE_ICON[k]}
          </span>
        );
      })}
    </div>
  );
}

// Preview del cambio de stats al subir un edificio de nivel (Cambio B2).
function UpgradePreview({ preview }: { preview: StatDelta[] }) {
  if (preview.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-0.5 rounded-md bg-zinc-800/40 px-2 py-1.5">
      {preview.map((d) => (
        <div key={d.label} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-zinc-400">{d.label}</span>
          <span className="tabular-nums text-zinc-300">
            {d.from} <span className="text-zinc-500">→</span>{" "}
            <span className="font-medium text-emerald-300">{d.to}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Nombre del asentamiento, editable inline (CAMBIO 1). 1 cambio cada 24h.
function SettlementName({
  name,
  renameInfo,
  onRename,
}: {
  name: string;
  renameInfo: SettlementView["rename"];
  onRename: (name: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const err = await onRename(value.trim());
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="truncate text-xl font-semibold">{name}</h1>
        <button
          onClick={() => {
            setValue(name);
            setError(null);
            setEditing(true);
          }}
          disabled={!renameInfo.canRename}
          title={
            renameInfo.canRename
              ? "Cambiar el nombre"
              : `Podrás cambiarlo en ${fmtDuration(renameInfo.cooldownSecondsRemaining)}`
          }
          className="text-sm text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Cambiar nombre"
        >
          ✏️
        </button>
      </div>
    );
  }

  // En móvil el input y los botones se apilan: así "Guardar" queda SIEMPRE visible
  // (antes, en horizontal, lo tapaban el email y el enlace del mapa de la cabecera).
  return (
    <div className="flex w-full flex-col gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        maxLength={32}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-lg font-semibold outline-none focus:border-indigo-500"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Cancelar
        </button>
      </div>
      <p className="text-xs text-zinc-500">Solo puedes cambiar el nombre una vez cada 24 h.</p>
      {error && <p className="text-xs text-rose-400">⚠️ {error}</p>}
    </div>
  );
}

export default function Game() {
  const router = useRouter();
  const [view, setView] = useState<SettlementView | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [summary, setSummary] = useState<ResolveSummary | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [panelOpen, setPanelOpen] = useState(false);
  // Nº de hazañas completadas pendientes de canje (badge en el botón de Hazañas).
  const [pendingClaims, setPendingClaims] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingEvent, setPendingEvent] = useState<EventView | null>(null);
  const [eventBusy, setEventBusy] = useState(false);
  const toastId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  // Empuja toasts a partir de las reacciones del servidor (hazañas + referido).
  const pushReactions = useCallback(
    (newAchievements?: CompletedAchievement[], referralActivated?: boolean) => {
      const next: Toast[] = [];
      for (const a of newAchievements ?? []) {
        next.push({
          id: ++toastId.current,
          kind: "achievement",
          title: `🏆 ${a.title}`,
          subtitle: "¡Hazaña completada! Reclama tu recompensa en 🏆 Hazañas.",
        });
      }
      if (referralActivated) {
        next.push({
          id: ++toastId.current,
          kind: "referral",
          title: "🎉 ¡Invitación activada!",
          subtitle: "Quien te invitó ha recibido 25 de cada recurso.",
        });
      }
      if (next.length > 0) setToasts((ts) => [...ts, ...next]);
    },
    [],
  );

  // Carga el estado del asentamiento (resuelve el cálculo diferido en el servidor).
  // `showAway` controla si se muestra el resumen de "mientras no estabas" (solo al
  // entrar, no en los refrescos automáticos al terminar una obra).
  const load = useCallback(
    async (showAway: boolean) => {
      const res = await fetch("/api/settlement");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar");
      // Onboarding pendiente: sin región, al selector de región (CAMBIO 3).
      if (!data.settlement?.region) {
        router.replace("/onboarding");
        return;
      }
      setView(data.settlement);
      setPlayer(data.player ?? null);
      setPendingClaims(data.pendingClaims ?? 0);
      if (showAway && isNotableSummary(data.summary)) {
        setSummary(data.summary);
        setShowSummary(true);
      }
      pushReactions(data.newAchievements, data.referralActivated);
    },
    [router, pushReactions],
  );

  // Comprueba si hay un evento aleatorio activo (genera uno si procede en el servidor).
  const loadEvent = useCallback(async () => {
    try {
      const res = await fetch("/api/events/pending");
      if (!res.ok) return;
      const data = await res.json();
      setPendingEvent(data.event ?? null);
    } catch {
      /* silencioso: los eventos no deben romper la carga del juego */
    }
  }, []);

  // Resuelve el evento activo (aceptar/rechazar). Refresca el estado del asentamiento.
  const resolveEvent = useCallback(
    async (action: "accept" | "decline") => {
      if (!pendingEvent) return;
      setEventBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/${pendingEvent.id}/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo resolver el evento");
        if (data.settlement) setView(data.settlement);
        setPendingClaims((n) => n + (data.newAchievements?.length ?? 0));
        pushReactions(data.newAchievements);
        setPendingEvent(null);
        // Por si tocara encolar otro (poco habitual: el timer no ha corrido aún).
        loadEvent();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setEventBusy(false);
      }
    },
    [pendingEvent, pushReactions, loadEvent],
  );

  // Carga inicial.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await load(true);
        if (active) await loadEvent();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Error al cargar");
      }
    })();
    return () => {
      active = false;
    };
  }, [load, loadEvent]);

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
      setPendingClaims((n) => n + (data.newAchievements?.length ?? 0));
      pushReactions(data.newAchievements, data.referralActivated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [pushReactions]);

  // Renombre del asentamiento (CAMBIO 1). Devuelve mensaje de error o null.
  const rename = useCallback(async (name: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/settlement/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? "No se pudo renombrar.";
      setView(data.settlement);
      return null;
    } catch {
      return "Error de red al renombrar.";
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

  const eligible = computeEligibleSteps(view, showSummary, summary);

  return (
    <TutorialProvider initialProgress={view.tutorialProgress} eligible={eligible}>
      <GameView
        view={view}
        player={player}
        summary={summary}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        error={error}
        busy={busy}
        nowMs={nowMs}
        dispatch={dispatch}
        rename={rename}
        onOpenPanel={() => setPanelOpen(true)}
        pendingClaims={pendingClaims}
      />
      <TutorialLayer />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {panelOpen && (
        <AchievementsPanel
          onClose={() => setPanelOpen(false)}
          onClaimed={() => load(false).catch(() => {})}
        />
      )}
      {pendingEvent && (
        <EventModal
          event={pendingEvent}
          resources={view.resources}
          busy={eventBusy}
          onResolve={resolveEvent}
        />
      )}
    </TutorialProvider>
  );
}

// Decide qué pasos del tutorial pueden mostrarse según el estado actual del juego
// (Cambio C). El provider elige luego el de mayor prioridad pendiente con ancla.
function computeEligibleSteps(
  view: SettlementView,
  showSummary: boolean,
  summary: ResolveSummary | null,
): TutorialStepId[] {
  const e: TutorialStepId[] = ["sawSawmill", "sawResources", "sawTownHall", "sawBuildMenu"];
  if (view.buildings.some((b) => b.produces && b.level >= 1 && b.maxWorkers > 0)) {
    e.push("sawColonistAssign");
  }
  if (showSummary && summary) e.push("sawClaim");
  const { cap, food, wood, stone } = view.resources;
  if (cap > 0 && [food, wood, stone].some((v) => v >= cap * 0.9)) e.push("sawStorageFull");
  const hasHouse = view.buildings.some((b) => b.type === "HOUSE");
  if (!hasHouse && view.population.free >= 1) e.push("sawHouseHint");
  return e;
}

interface GameViewProps {
  view: SettlementView;
  player: PlayerInfo | null;
  summary: ResolveSummary | null;
  showSummary: boolean;
  setShowSummary: (v: boolean) => void;
  error: string | null;
  busy: boolean;
  nowMs: number;
  dispatch: (action: ActionBody) => void;
  rename: (name: string) => Promise<string | null>;
  onOpenPanel: () => void;
  pendingClaims: number;
}

// Toda la UI del asentamiento. Vive dentro de <TutorialProvider> para poder
// registrar anclas de coachmarks (Cambio C).
function GameView({
  view,
  player,
  summary,
  showSummary,
  setShowSummary,
  error,
  busy,
  nowMs,
  dispatch,
  rename,
  onOpenPanel,
  pendingClaims,
}: GameViewProps) {
  const { resources, population, rates, welfare } = view;
  const welfareDanger = welfare < 70;

  // Anclas del tutorial para las distintas zonas de la pantalla.
  const resAnchor = useTutorialAnchor("sawResources");
  const storeAnchor = useTutorialAnchor("sawStorageFull");
  const resourcesRef = useCallback(
    (el: HTMLElement | null) => {
      resAnchor(el);
      storeAnchor(el);
    },
    [resAnchor, storeAnchor],
  );
  const townHallAnchor = useTutorialAnchor("sawTownHall");
  const buildMenuAnchor = useTutorialAnchor("sawBuildMenu");
  const firstAssignableId =
    view.buildings.find((b) => b.produces && b.level >= 1 && b.maxWorkers > 0)?.id ?? null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 bg-zinc-950 px-4 py-5 text-zinc-100">
      {/* Cabecera */}
      <header className="flex items-start justify-between">
        <div className="min-w-0">
          <SettlementName name={view.name} renameInfo={view.rename} onRename={rename} />
          <span className="block text-sm text-zinc-400">
            {BUILDING_ICON.TOWN_HALL} Ayuntamiento N{view.townHallLevel}
            {view.regionName && <> · 🗺️ {view.regionName}</>}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          {player && <span className="text-xs text-zinc-500">{displayPlayerName(player)}</span>}
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenPanel}
              className="relative text-xs text-amber-300 hover:text-amber-200"
            >
              🏆 Hazañas
              {pendingClaims > 0 && (
                <span
                  className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white"
                  aria-label={`${pendingClaims} recompensas pendientes`}
                >
                  {pendingClaims}
                </span>
              )}
            </button>
            <Link href="/map" className="text-xs text-indigo-400 hover:text-indigo-300">Mapa</Link>
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
      <section ref={resourcesRef} className="grid grid-cols-2 gap-2">
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
              have={resources}
              freeColonists={population.free}
              busy={busy}
              nowMs={nowMs}
              colonistAnchor={b.id === firstAssignableId}
              onAssign={(workers) => dispatch({ kind: "assign", buildingId: b.id, workers })}
              onUpgrade={() => dispatch({ kind: "upgrade", buildingId: b.id })}
            />
          ))}
      </section>

      {/* Subir Ayuntamiento */}
      <TownHallCard
        th={view.townHallUpgrade}
        level={view.townHallLevel}
        have={resources}
        busy={busy}
        nowMs={nowMs}
        anchorRef={townHallAnchor}
        construction={view.buildings.find((b) => b.type === "TOWN_HALL")?.construction ?? null}
        onUpgrade={() => dispatch({ kind: "upgradeTownHall" })}
      />

      {/* Construir */}
      <section ref={buildMenuAnchor} className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-400">
          Construir <span className="text-zinc-600">({view.buildings.length}/{view.maxBuildings})</span>
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {view.buildOptions.map((o) => (
            <BuildOptionButton key={o.type} o={o} have={resources} busy={busy} onBuild={() => dispatch({ kind: "build", buildingType: o.type })} />
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
  have,
  freeColonists,
  busy,
  nowMs,
  colonistAnchor = false,
  onAssign,
  onUpgrade,
}: {
  b: BuildingView;
  have: Held;
  freeColonists: number;
  busy: boolean;
  nowMs: number;
  colonistAnchor?: boolean; // este edificio es el ancla del coachmark de colonos
  onAssign: (workers: number) => void;
  onUpgrade: () => void;
}) {
  const isProducer = b.produces !== null;
  const isNew = b.level === 0; // construcción inicial (aún no funcional)
  const showWorkers = isProducer && !isNew;
  const canAddWorker = showWorkers && b.workers < b.maxWorkers && freeColonists > 0;
  const canRemoveWorker = showWorkers && b.workers > 0;
  const colonistRef = useTutorialAnchor(colonistAnchor && showWorkers ? "sawColonistAssign" : null);

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
        <div ref={colonistRef} className="mt-2 flex items-center gap-3">
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
        b.upgrade.atMax ? (
          <p className="mt-2 text-xs text-zinc-500">✦ Nivel máximo alcanzado</p>
        ) : (
          <div className="mt-3 border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-zinc-500">
              <span>Mejora a N{b.level + 1}</span>
            </div>
            <UpgradePreview preview={b.upgrade.preview} />
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-zinc-500">Coste</span>
                <ResourceCost cost={b.upgrade.cost} have={have} />
              </div>
              <button
                disabled={busy || !b.upgrade.canUpgrade}
                onClick={onUpgrade}
                title={b.upgrade.canUpgrade ? `Tarda ${fmtDuration(b.upgrade.durationSeconds)}` : b.upgrade.reason}
                className="shrink-0 rounded bg-indigo-600 px-3 py-1 text-sm font-medium disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                Mejorar · ⏱ {fmtDuration(b.upgrade.durationSeconds)}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function TownHallCard({
  th,
  level,
  have,
  busy,
  nowMs,
  anchorRef,
  construction,
  onUpgrade,
}: {
  th: TownHallUpgrade;
  level: number;
  have: Held;
  busy: boolean;
  nowMs: number;
  anchorRef?: (el: HTMLElement | null) => void;
  construction: BuildingView["construction"];
  onUpgrade: () => void;
}) {
  return (
    <section ref={anchorRef} className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{BUILDING_ICON.TOWN_HALL} Ayuntamiento N{level}</span>
        {th.atMax && <span className="text-xs text-zinc-500">✦ Nivel máximo alcanzado</span>}
      </div>

      {construction && (
        <ConstructionBar construction={construction} nowMs={nowMs} label={`Mejorando a N${construction.toLevel}`} />
      )}

      {!th.atMax && !construction && (
        <div className="mt-3 border-t border-amber-900/40 pt-2">
          <span className="text-[11px] uppercase tracking-wide text-amber-200/70">Subir a N{level + 1}</span>
          <UpgradePreview preview={th.preview} />
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-zinc-500">Coste</span>
              <ResourceCost cost={th.cost} have={have} />
            </div>
            <button
              disabled={busy || !th.canUpgrade}
              onClick={onUpgrade}
              title={th.canUpgrade ? `Tarda ${fmtDuration(th.durationSeconds)}` : th.reason}
              className="shrink-0 rounded bg-amber-600 px-3 py-1 text-sm font-medium text-black disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Subir · ⏱ {fmtDuration(th.durationSeconds)}
            </button>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-zinc-400">Sube el techo de edificios y de nivel. La progresión del asentamiento.</p>
    </section>
  );
}

function BuildOptionButton({ o, have, busy, onBuild }: { o: BuildOption; have: Held; busy: boolean; onBuild: () => void }) {
  const locked = o.lockedByTownHall !== null;
  const lockMsg = locked ? `Requiere Ayuntamiento N${o.lockedByTownHall}` : undefined;
  const { complete, isDone } = useTutorial();
  // La Serrería y la Casa son anclas de sus respectivos coachmarks.
  const stepForType: TutorialStepId | null =
    o.type === "SAWMILL" ? "sawSawmill" : o.type === "HOUSE" ? "sawHouseHint" : null;
  const anchorRef = useTutorialAnchor(stepForType);

  function handleClick() {
    // Interactuar con el menú de construcción completa el coachmark bloqueante inicial.
    if (!isDone("sawSawmill")) complete("sawSawmill");
    onBuild();
  }

  return (
    <button
      ref={anchorRef}
      disabled={busy || !o.canBuild}
      onClick={handleClick}
      title={locked ? lockMsg : o.canBuild ? `Tarda ${fmtDuration(o.durationSeconds)}` : o.reason}
      className={`flex flex-col items-start gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left disabled:cursor-not-allowed ${
        locked ? "opacity-50" : "disabled:opacity-40"
      }`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {BUILDING_ICON[o.type]} {BUILDING_LABEL[o.type]}
        </span>
        {locked ? (
          <span className="text-xs text-zinc-500">🔒</span>
        ) : (
          <span className="text-xs text-amber-400/80">⏱ {fmtDuration(o.durationSeconds)}</span>
        )}
      </div>
      {locked ? (
        <span className="text-xs text-zinc-500">{lockMsg}</span>
      ) : (
        <ResourceCost cost={o.cost} have={have} />
      )}
    </button>
  );
}

function AwaySummary({ summary, onClose }: { summary: ResolveSummary; onClose: () => void }) {
  const claimAnchor = useTutorialAnchor("sawClaim");
  const lines: string[] = [];
  if (summary.food > 0.5) lines.push(`+${fmt(summary.food)} 🍞`);
  if (summary.wood > 0.5) lines.push(`+${fmt(summary.wood)} 🪵`);
  if (summary.stone > 0.5) lines.push(`+${fmt(summary.stone)} 🪨`);
  if (summary.colonistsArrived > 0) lines.push(`👶 llegó ${summary.colonistsArrived} colono${summary.colonistsArrived === 1 ? "" : "s"}`);
  if (summary.colonistsLost > 0) lines.push(`💀 perdiste ${summary.colonistsLost} colono${summary.colonistsLost === 1 ? "" : "s"}`);
  if (summary.buildingsCompleted > 0) lines.push(`🏗️ ${summary.buildingsCompleted} obra${summary.buildingsCompleted === 1 ? "" : "s"} terminada${summary.buildingsCompleted === 1 ? "" : "s"}`);
  if (summary.plagueActive) lines.push("🦠 hubo una plaga");

  return (
    <div ref={claimAnchor} className="rounded-lg border border-indigo-800 bg-indigo-950/40 p-3">
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
