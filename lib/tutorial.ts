// ============================================================================
// tutorial.ts — definición de los pasos del tutorial (Cambio C).
//
// Cada paso es un coachmark: un mensaje anclado a un elemento de la UI que se
// muestra UNA vez y, al verse, se marca como completado en BD (Settlement.
// tutorialProgress). El cliente decide CUÁNDO se cumple la condición de cada
// paso; aquí solo viven los textos, el orden y si bloquea.
// ============================================================================

export const TUTORIAL_STEP_IDS = [
  "sawSawmill",
  "sawResources",
  "sawTownHall",
  "sawBuildMenu",
  "sawColonistAssign",
  "sawClaim",
  "sawStorageFull",
  "sawHouseHint",
] as const;

export type TutorialStepId = (typeof TUTORIAL_STEP_IDS)[number];

export interface TutorialStep {
  id: TutorialStepId;
  message: string;
  // Bloqueante: el coachmark no se cierra con un botón; solo desaparece cuando el
  // jugador interactúa con el elemento resaltado (se completa desde fuera).
  blocking: boolean;
}

// Orden = prioridad de aparición. Solo se muestra un coachmark a la vez: el de
// mayor prioridad cuya condición se cumpla y que aún no esté completado.
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "sawSawmill",
    message:
      "Empieza construyendo una Serrería. Sin madera no podrás construir nada más.",
    blocking: true,
  },
  {
    id: "sawResources",
    message:
      "Estos son tus recursos. Madera y comida son los primeros que necesitas.",
    blocking: false,
  },
  {
    id: "sawTownHall",
    message:
      "El Ayuntamiento limita cuántos edificios puedes tener. Mejóralo para crecer.",
    blocking: false,
  },
  {
    id: "sawBuildMenu",
    message:
      "Cada edificio necesita colonos asignados para producir. Sin colonos, sin recursos.",
    blocking: false,
  },
  {
    id: "sawColonistAssign",
    message:
      "Asigna colonos a tus edificios con + y −. Más colonos, más producción.",
    blocking: false,
  },
  {
    id: "sawClaim",
    message:
      "Los recursos se acumulan mientras no juegas. Reclámalos cuando vuelvas.",
    blocking: false,
  },
  {
    id: "sawStorageFull",
    message:
      "El almacén está casi lleno. Si se llena, los recursos dejarán de acumularse.",
    blocking: false,
  },
  {
    id: "sawHouseHint",
    message:
      "Con más colonos puedes construir más edificios. La Casa genera un colono nuevo cada día.",
    blocking: false,
  },
];

export type TutorialProgress = Partial<Record<TutorialStepId, boolean>>;

/** Normaliza el JSON crudo de BD a un mapa de booleanos con claves válidas. */
export function parseTutorialProgress(raw: unknown): TutorialProgress {
  const out: TutorialProgress = {};
  if (raw && typeof raw === "object") {
    for (const id of TUTORIAL_STEP_IDS) {
      if ((raw as Record<string, unknown>)[id] === true) out[id] = true;
    }
  }
  return out;
}

/** ¿Es `value` un id de paso válido? (para validar el body del endpoint). */
export function isTutorialStepId(value: unknown): value is TutorialStepId {
  return typeof value === "string" && (TUTORIAL_STEP_IDS as readonly string[]).includes(value);
}
