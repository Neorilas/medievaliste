"use client";

// Hook que encapsula la lógica de instalación de la PWA (Cambio B).
// Captura el evento `beforeinstallprompt` (Chromium) para poder disparar el
// diálogo nativo de instalación cuando el jugador pulse "Instalar", detecta iOS
// (que no soporta ese evento y necesita instrucciones manuales) y recuerda en
// localStorage si el jugador ya cerró la pantalla para no volver a mostrarla.

import { useCallback, useEffect, useState } from "react";

const DISMISS_KEY = "installPromptDismissed";

// El evento no está tipado en lib.dom; lo declaramos mínimamente.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PWAInstall {
  /** Hay un diálogo de instalación nativo disponible (Chromium con criterios cumplidos). */
  isInstallable: boolean;
  /** El navegador es iOS/Safari: instalación solo manual (icono Compartir → Añadir a inicio). */
  isIOS: boolean;
  /** La app ya corre instalada (display-mode standalone). */
  isStandalone: boolean;
  /** El jugador ya cerró la pantalla antes (flag en localStorage). */
  dismissed: boolean;
  /** Indica si ya se ha leído el estado del cliente (evita parpadeo en SSR/hidratación). */
  ready: boolean;
  /** Dispara el diálogo nativo de instalación. Devuelve true si el usuario aceptó. */
  triggerInstall: () => Promise<boolean>;
  /** Marca la pantalla como descartada (no se volverá a mostrar). */
  dismiss: () => void;
}

export function usePWAInstall(): PWAInstall {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Detección de plataforma y estado: solo se puede leer en cliente (navigator,
    // matchMedia, localStorage no existen en SSR), de ahí el volcado a estado al
    // montar y el disable puntual de set-state-in-effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    const ua = navigator.userAgent || "";
    setIsIOS(/iphone|ipad|ipod/i.test(ua) && !("MSStream" in window));
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // iOS marca las apps instaladas con navigator.standalone.
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // localStorage puede no estar disponible (modo privado estricto): tratamos
      // como no descartado.
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // evita el mini-infobar automático; lo lanzamos nosotros
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sin persistencia: al menos lo ocultamos en esta sesión */
    }
    setDismissed(true);
  }, []);

  const triggerInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome === "accepted";
  }, [deferred]);

  return {
    isInstallable: deferred !== null,
    isIOS,
    isStandalone,
    dismissed,
    ready,
    triggerInstall,
    dismiss,
  };
}
