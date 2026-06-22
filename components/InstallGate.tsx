"use client";

// Puerta de entrada de la PWA (Cambio B). Se monta en el layout raíz y decide si
// mostrar la pantalla de instalación ANTES de dejar ver la app:
//   - Si ya corre instalada (standalone) → no muestra nada.
//   - Si el jugador ya la descartó (localStorage) → no muestra nada.
//   - En otro caso → superpone InstallPromptScreen hasta que el jugador elige.
// También registra el service worker (requisito de instalabilidad en Chromium).

import { useEffect, useState } from "react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { InstallPromptScreen } from "./InstallPromptScreen";

export function InstallGate({ children }: { children: React.ReactNode }) {
  const pwa = usePWAInstall();
  const [continued, setContinued] = useState(false);

  // Registra el service worker una sola vez (solo si está instalado standalone o
  // no, da igual: habilita la instalabilidad cuando aún no lo está).
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Sin SW la app sigue funcionando; solo se pierde el diálogo de instalación.
      });
    }
  }, []);

  // Mientras no sepamos el estado del cliente, renderizamos la app tal cual (la
  // pantalla aparecería tras la hidratación si procede; evita parpadeo en SSR).
  const showScreen = pwa.ready && !pwa.isStandalone && !pwa.dismissed && !continued;

  return (
    <>
      {children}
      {showScreen && (
        <InstallPromptScreen pwa={pwa} onContinue={() => setContinued(true)} />
      )}
    </>
  );
}
