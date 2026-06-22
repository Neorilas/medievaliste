"use client";

// /join?ref=CODE — aterrizaje del enlace de invitación. Guarda el código en
// sessionStorage (para que sobreviva al flujo de registro) y redirige a /register.
// Si no hay código, simplemente manda a registro.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const REFERRAL_STORAGE_KEY = "asentamiento.ref";

function JoinRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const ref = params.get("ref");
    if (ref) {
      try {
        sessionStorage.setItem(REFERRAL_STORAGE_KEY, ref);
      } catch {
        // sessionStorage puede no estar disponible (modo privado); seguimos igual.
      }
    }
    router.replace("/register");
  }, [params, router]);

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-400">
      Preparando tu invitación…
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center bg-zinc-950 text-zinc-400">
          Cargando…
        </main>
      }
    >
      <JoinRedirect />
    </Suspense>
  );
}
