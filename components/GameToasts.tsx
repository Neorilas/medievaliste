"use client";

// Notificaciones efímeras (Bloque 3): hazaña completada o referido activado.
// Aparecen apiladas arriba y desaparecen solas a los 4s (o al pulsar).

import { useEffect } from "react";

export interface Toast {
  id: number;
  kind: "achievement" | "referral";
  title: string;
  subtitle: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Auto-cierre a los 4s.
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const accent =
    toast.kind === "achievement"
      ? "border-amber-700 bg-amber-950/80"
      : "border-emerald-700 bg-emerald-950/80";

  return (
    <button
      onClick={onDismiss}
      className={`pointer-events-auto w-full max-w-md rounded-lg border ${accent} px-4 py-3 text-left shadow-lg backdrop-blur transition-all`}
    >
      <p className="text-sm font-semibold text-zinc-100">{toast.title}</p>
      {toast.subtitle && <p className="mt-0.5 text-xs text-zinc-300">{toast.subtitle}</p>}
    </button>
  );
}
