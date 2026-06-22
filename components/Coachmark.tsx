"use client";

// Coachmark reutilizable (Cambio C): superpone un overlay oscuro con un recorte
// (spotlight) sobre el elemento objetivo y un globo con el mensaje. El recorte se
// logra con un box-shadow enorme alrededor del rectángulo del objetivo.
//
//   - blocking=false → el globo trae un botón "Entendido" que cierra (onClose).
//   - blocking=true  → sin botón; el hueco deja pasar los clics al objetivo para
//     que el jugador interactúe con él (el paso se completa desde fuera).

import { useEffect, useLayoutEffect, useState } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function Coachmark({
  target,
  message,
  blocking = false,
  onClose,
}: {
  target: HTMLElement | null;
  message: string;
  blocking?: boolean;
  onClose?: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  // Mantiene el rectángulo del objetivo al día ante scroll, resize o cambios de
  // tamaño del propio elemento. Medir el DOM y volcarlo a estado es justamente el
  // caso para el que existe useLayoutEffect (no hay forma de leer el rect en SSR),
  // de ahí el disable puntual de set-state-in-effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const update = () => setRect(readRect(target));
    update();
    // Asegura que el objetivo es visible antes de resaltarlo.
    target.scrollIntoView({ block: "center", behavior: "smooth" });

    const ro = new ResizeObserver(update);
    ro.observe(target);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target]);

  // Reposiciona tras el scrollIntoView (la animación mueve el rect unos frames).
  useEffect(() => {
    if (!target) return;
    const id = setTimeout(() => setRect(readRect(target)), 350);
    return () => clearTimeout(id);
  }, [target]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!rect) return null;

  const pad = 8;
  const holeTop = Math.max(0, rect.top - pad);
  const holeLeft = Math.max(0, rect.left - pad);
  const holeW = rect.width + pad * 2;
  const holeH = rect.height + pad * 2;

  // Coloca el globo debajo del objetivo si hay sitio; si no, encima.
  const below = holeTop + holeH + 140 < window.innerHeight;
  const tipTop = below ? holeTop + holeH + 12 : Math.max(12, holeTop - 12);

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {/* Spotlight: hueco transparente con sombra envolvente que oscurece el resto. */}
      <div
        aria-hidden
        className="absolute rounded-xl ring-2 ring-indigo-400/80 transition-all"
        style={{
          top: holeTop,
          left: holeLeft,
          width: holeW,
          height: holeH,
          boxShadow: "0 0 0 9999px rgba(9,9,11,0.72)",
        }}
      />
      {/* Globo de mensaje. */}
      <div
        role="dialog"
        aria-live="polite"
        className="pointer-events-auto absolute left-1/2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-indigo-700 bg-zinc-900 p-4 shadow-xl"
        style={below ? { top: tipTop } : { bottom: window.innerHeight - tipTop }}
      >
        <p className="text-sm text-zinc-100">{message}</p>
        {blocking ? (
          <p className="mt-2 text-xs text-indigo-300">👆 Pulsa el elemento resaltado para continuar.</p>
        ) : (
          <div className="mt-3 flex justify-end">
            <button
              onClick={onClose}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Entendido
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
