"use client";

// Pantalla a pantalla completa que sugiere instalar la PWA (Cambio B).
// No bloquea: siempre hay un botón para seguir en el navegador. En iOS muestra
// las instrucciones manuales (Compartir → Añadir a pantalla de inicio); en el
// resto, un botón que dispara el diálogo nativo de instalación.

import { useState } from "react";
import type { PWAInstall } from "@/hooks/usePWAInstall";

export function InstallPromptScreen({
  pwa,
  onContinue,
}: {
  pwa: PWAInstall;
  onContinue: () => void;
}) {
  const [installing, setInstalling] = useState(false);

  async function handleInstall() {
    setInstalling(true);
    const accepted = await pwa.triggerInstall();
    setInstalling(false);
    // Tanto si acepta (se instalará) como si no, cerramos la pantalla y dejamos
    // pasar al jugador. El flag de descartado evita que vuelva a aparecer.
    pwa.dismiss();
    onContinue();
    void accepted;
  }

  function handleContinue() {
    pwa.dismiss();
    onContinue();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="flex flex-col items-center gap-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={96} height={96} className="rounded-2xl" />
        <div>
          <h1 className="text-2xl font-semibold">Instala Asentamiento</h1>
          <p className="mt-2 max-w-xs text-sm text-zinc-400">
            Añádelo a tu pantalla de inicio para abrirlo como una app: a pantalla
            completa, más rápido y sin la barra del navegador.
          </p>
        </div>
      </div>

      {pwa.isIOS ? (
        <ol className="flex max-w-xs flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          <li className="flex items-center gap-3">
            <span className="text-lg">①</span>
            <span>
              Pulsa el icono <span className="font-medium text-zinc-100">Compartir</span>{" "}
              <span aria-hidden>⬆️</span> de Safari.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="text-lg">②</span>
            <span>
              Elige <span className="font-medium text-zinc-100">Añadir a pantalla de inicio</span>{" "}
              <span aria-hidden>➕</span>.
            </span>
          </li>
        </ol>
      ) : (
        <button
          onClick={handleInstall}
          disabled={installing || !pwa.isInstallable}
          title={
            pwa.isInstallable
              ? "Instalar la app"
              : "Tu navegador aún no ofrece la instalación. Inténtalo desde el menú del navegador."
          }
          className="w-full max-w-xs rounded-lg bg-indigo-600 px-4 py-3 text-base font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {installing ? "Instalando…" : "📲 Instalar"}
        </button>
      )}

      {!pwa.isIOS && !pwa.isInstallable && (
        <p className="-mt-4 max-w-xs text-center text-xs text-zinc-500">
          Si no se activa, busca “Instalar app” o “Añadir a pantalla de inicio” en el
          menú de tu navegador.
        </p>
      )}

      <button
        onClick={handleContinue}
        className="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
      >
        Continuar en el navegador
      </button>
    </div>
  );
}
