"use client";

// Panel de Hazañas (Bloque 3). Modal con dos pestañas:
//   - Hazañas: disponibles (con progreso), completadas y bloqueadas.
//   - Invita amigos: enlace de referido + lista de invitados.
// Solo MUESTRA estado; los datos vienen de /api/achievements y /api/referrals.

import { useCallback, useEffect, useState } from "react";

// --- Tipos espejo de las respuestas de la API ---
interface Reward {
  wood?: number;
  food?: number;
  stone?: number;
  colonist?: number;
}
interface AchievementProgress {
  def: {
    id: string;
    chainId: string | null;
    chainOrder: number | null;
    title: string;
    description: string;
    conditionValue: number;
    reward: Reward;
  };
  current: number;
  target: number;
  completedAt: string | null;
  // null mientras esté pendiente de canje; fecha una vez reclamada.
  claimedAt: string | null;
}
interface AchievementsData {
  completed: AchievementProgress[];
  available: AchievementProgress[];
  locked: { id: string; title: string; chainId: string | null }[];
}
interface ReferralsData {
  referralCode: string;
  referralLink: string;
  referrals: {
    username: string;
    joinedAt: string;
    activated: boolean;
    rewardDeliveredAt: string | null;
  }[];
  totalActivated: number;
  totalRewardReceived: { wood: number; food: number; stone: number };
}

const REWARD_ICON: Record<keyof Reward, string> = {
  wood: "🪵",
  food: "🍞",
  stone: "🪨",
  colonist: "👤",
};

/** Recompensa como texto compacto: "+50 🍞", "+100 🍞 +1 👤". */
export function formatReward(reward: Reward): string {
  const parts: string[] = [];
  for (const key of ["wood", "food", "stone", "colonist"] as const) {
    const v = reward[key];
    if (v) parts.push(`+${v} ${REWARD_ICON[key]}`);
  }
  return parts.join(" ");
}

// Etiqueta explícita para el feedback de canje ("+50 madera").
const REWARD_LABEL: Record<keyof Reward, [string, string]> = {
  wood: ["madera", "madera"],
  food: ["comida", "comida"],
  stone: ["piedra", "piedra"],
  colonist: ["colono", "colonos"],
};

/** Recompensa en texto legible: "+50 madera" · "+100 comida, +1 colono". */
function formatRewardObtained(reward: Reward): string {
  const parts: string[] = [];
  for (const key of ["wood", "food", "stone", "colonist"] as const) {
    const v = reward[key];
    if (v) {
      const [singular, plural] = REWARD_LABEL[key];
      parts.push(`+${v} ${v === 1 ? singular : plural}`);
    }
  }
  return parts.join(", ");
}

type Tab = "achievements" | "referrals";

export function AchievementsPanel({
  onClose,
  onClaimed,
}: {
  onClose: () => void;
  // Se invoca tras un canje con éxito para refrescar recursos y el badge del padre.
  onClaimed: () => void;
}) {
  const [tab, setTab] = useState<Tab>("achievements");

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera con pestañas */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex gap-1">
            <TabButton active={tab === "achievements"} onClick={() => setTab("achievements")}>
              🏆 Hazañas
            </TabButton>
            <TabButton active={tab === "referrals"} onClick={() => setTab("referrals")}>
              🎁 Invita amigos
            </TabButton>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "achievements" ? <AchievementsTab onClaimed={onClaimed} /> : <ReferralsTab />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Pestaña de hazañas
// ----------------------------------------------------------------------------
function AchievementsTab({ onClaimed }: { onClaimed: () => void }) {
  const [data, setData] = useState<AchievementsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/achievements")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => active && setError("Error al cargar las hazañas."));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="text-sm text-rose-400">⚠️ {error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Cargando hazañas…</p>;

  return (
    <div className="flex flex-col gap-5">
      {data.available.length > 0 && (
        <Section title="Disponibles">
          {data.available.map((a) => (
            <AvailableCard key={a.def.id} a={a} />
          ))}
        </Section>
      )}

      {data.completed.length > 0 && (
        <Section title={`Completadas (${data.completed.length})`}>
          {data.completed.map((a) => (
            <CompletedCard key={a.def.id} a={a} onClaimed={onClaimed} />
          ))}
        </Section>
      )}

      {data.locked.length > 0 && (
        <Section title="Bloqueadas">
          {data.locked.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-500"
            >
              🔒 <span>{l.title}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function AvailableCard({ a }: { a: AchievementProgress }) {
  const pct = a.target > 0 ? Math.min(100, Math.round((a.current / a.target) * 100)) : 0;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{a.def.title}</p>
          <p className="text-xs text-zinc-400">{a.def.description}</p>
        </div>
        <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-emerald-300">
          {formatReward(a.def.reward)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
          <div className="h-full rounded bg-indigo-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-zinc-400">
          {a.current} / {a.target}
        </span>
      </div>
    </div>
  );
}

function CompletedCard({ a, onClaimed }: { a: AchievementProgress; onClaimed: () => void }) {
  // Estado de canje local: arranca de claimedAt y se vuelve true tras reclamar, sin
  // depender de recargar la lista (el padre solo refresca recursos y el badge).
  const [claimed, setClaimed] = useState(a.claimedAt !== null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/achievements/claim/${a.def.id}`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo reclamar la recompensa.");
      setFeedback(formatRewardObtained(d.reward ?? a.def.reward));
      setClaimed(true);
      onClaimed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al reclamar.");
    } finally {
      setBusy(false);
    }
  }, [a.def.id, a.def.reward, onClaimed]);

  // Pendiente de canje: condición cumplida pero recompensa sin reclamar.
  if (!claimed) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-200">✓ {a.def.title}</p>
            <p className="truncate text-xs text-zinc-500">{a.def.description}</p>
          </div>
          <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-emerald-300">
            {formatReward(a.def.reward)}
          </span>
        </div>
        <button
          onClick={claim}
          disabled={busy}
          className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? "Reclamando…" : "Reclamar recompensa"}
        </button>
        {error && <p className="mt-1.5 text-xs text-rose-400">⚠️ {error}</p>}
      </div>
    );
  }

  // Reclamada: recompensa ya aplicada.
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-emerald-200">✓ {a.def.title}</p>
        {feedback ? (
          <p className="truncate text-xs text-emerald-400">{feedback} obtenida</p>
        ) : (
          <p className="truncate text-xs text-zinc-500">{a.def.description}</p>
        )}
      </div>
      <span className="shrink-0 text-xs text-emerald-400">{formatReward(a.def.reward)}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Pestaña de referidos
// ----------------------------------------------------------------------------
function ReferralsTab() {
  const [data, setData] = useState<ReferralsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/referrals")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => active && setError("Error al cargar los referidos."));
    return () => {
      active = false;
    };
  }, []);

  const copy = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignorar: el input es seleccionable manualmente
    }
  }, [data]);

  const share = useCallback(async () => {
    if (!data) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Únete a mi asentamiento",
          text: "Funda tu asentamiento conmigo y empieza con un bonus de recursos.",
          url: data.referralLink,
        });
        return;
      } catch {
        // cancelado o no soportado: caer a copiar
      }
    }
    copy();
  }, [data, copy]);

  if (error) return <p className="text-sm text-rose-400">⚠️ {error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Cargando referidos…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-300">
        Cuando tu amigo llegue a <span className="font-medium text-amber-300">Ayuntamiento nivel 2</span>,
        recibiréis <span className="font-medium">25 de cada recurso</span>.
      </p>

      {/* Enlace + acciones */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
          <input
            readOnly
            value={data.referralLink}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent text-xs text-zinc-300 outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
          >
            {copied ? "¡Copiado! ✓" : "Copiar enlace"}
          </button>
          <button
            onClick={share}
            className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500"
          >
            Compartir
          </button>
        </div>
      </div>

      {/* Contador */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
        <p className="text-zinc-300">
          <span className="font-semibold text-emerald-300">{data.totalActivated}</span>{" "}
          {data.totalActivated === 1 ? "amigo activo" : "amigos activos"}
        </p>
        {data.totalActivated > 0 && (
          <p className="mt-1 text-xs text-zinc-400">
            Has recibido {data.totalRewardReceived.wood} 🪵 · {data.totalRewardReceived.food} 🍞 ·{" "}
            {data.totalRewardReceived.stone} 🪨 por referidos
          </p>
        )}
      </div>

      {/* Lista de referidos */}
      {data.referrals.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Tus invitados
          </h3>
          {data.referrals.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
            >
              <span className="truncate">{r.username}</span>
              <span className={r.activated ? "text-emerald-400" : "text-zinc-500"}>
                {r.activated ? "Activo ✓" : "Pendiente"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">
          Aún no has invitado a nadie. ¡Comparte tu enlace!
        </p>
      )}
    </div>
  );
}
