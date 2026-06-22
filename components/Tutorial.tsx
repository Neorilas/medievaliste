"use client";

// Coordinación del tutorial (Cambio C). Centraliza:
//   - el progreso (qué pasos ya se vieron), inicializado desde el servidor y
//     guardado de vuelta vía POST /api/tutorial/complete al completar uno;
//   - qué elementos de la UI están registrados como ancla de cada paso;
//   - cuál es el paso ACTIVO: el de mayor prioridad (orden de TUTORIAL_STEPS) que
//     esté pendiente, cuya condición de juego se cumpla (lista `eligible`) y cuya
//     ancla esté montada en pantalla.
// Solo se muestra un coachmark a la vez para no saturar.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  TUTORIAL_STEPS,
  type TutorialProgress,
  type TutorialStepId,
} from "@/lib/tutorial";
import { Coachmark } from "./Coachmark";

interface TutorialContextValue {
  isDone: (id: TutorialStepId) => boolean;
  complete: (id: TutorialStepId) => void;
  activeStep: TutorialStepId | null;
  registerAnchor: (id: TutorialStepId, el: HTMLElement | null) => void;
  getAnchor: (id: TutorialStepId) => HTMLElement | null;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({
  initialProgress,
  eligible,
  children,
}: {
  initialProgress: TutorialProgress;
  eligible: TutorialStepId[];
  children: React.ReactNode;
}) {
  // El progreso inicial (del servidor) se captura una vez al montar. A partir de
  // ahí mandan las marcas optimistas locales: un paso solo va de pendiente a visto,
  // así que no hace falta resincronizar con recargas posteriores de la vista.
  const [progress, setProgress] = useState<TutorialProgress>(initialProgress);
  const [anchors, setAnchors] = useState<Partial<Record<TutorialStepId, HTMLElement>>>({});

  const complete = useCallback((id: TutorialStepId) => {
    setProgress((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    fetch("/api/tutorial/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stepId: id }),
    }).catch(() => {
      // Si falla la persistencia, el paso reaparecerá en la próxima sesión: es
      // un coste asumible frente a bloquear al jugador.
    });
  }, []);

  const registerAnchor = useCallback((id: TutorialStepId, el: HTMLElement | null) => {
    setAnchors((prev) => {
      if (el) {
        if (prev[id] === el) return prev;
        return { ...prev, [id]: el };
      }
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const eligibleKey = eligible.join(",");
  const activeStep = useMemo<TutorialStepId | null>(() => {
    const eligibleSet = new Set(eligible);
    for (const step of TUTORIAL_STEPS) {
      if (progress[step.id]) continue;
      if (!eligibleSet.has(step.id)) continue;
      if (!anchors[step.id]) continue; // el ancla aún no está en pantalla
      return step.id;
    }
    return null;
    // eligibleKey representa el contenido de `eligible`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, anchors, eligibleKey]);

  const value = useMemo<TutorialContextValue>(
    () => ({
      isDone: (id) => !!progress[id],
      complete,
      activeStep,
      registerAnchor,
      getAnchor: (id) => anchors[id] ?? null,
    }),
    [progress, complete, activeStep, registerAnchor, anchors],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial debe usarse dentro de <TutorialProvider>");
  return ctx;
}

/**
 * Devuelve un ref callback para marcar un elemento como ancla de un paso del
 * tutorial. Acepta `null` para anclas condicionales (no registra nada).
 */
export function useTutorialAnchor(id: TutorialStepId | null) {
  const { registerAnchor } = useTutorial();
  return useCallback(
    (el: HTMLElement | null) => {
      if (id) registerAnchor(id, el);
    },
    [id, registerAnchor],
  );
}

/** Capa que pinta el coachmark del paso activo. Se monta una vez dentro del provider. */
export function TutorialLayer() {
  const { activeStep, getAnchor, complete } = useTutorial();
  if (!activeStep) return null;
  const step = TUTORIAL_STEPS.find((s) => s.id === activeStep);
  if (!step) return null;
  return (
    <Coachmark
      target={getAnchor(activeStep)}
      message={step.message}
      blocking={step.blocking}
      onClose={step.blocking ? undefined : () => complete(activeStep)}
    />
  );
}
