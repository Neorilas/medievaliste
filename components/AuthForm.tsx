"use client";

// Formulario de acceso reutilizable para /login y /register.
// - Credenciales (email/contraseña): en registro llama a /api/register y luego inicia sesión.
// - Google: solo si está configurado en el servidor (googleEnabled).

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function AuthForm({ mode, googleEnabled }: { mode: "login" | "register"; googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo crear la cuenta.");
      }
      // Inicia sesión con credenciales. redirect:false para poder mostrar el error.
      const result = (await signIn("credentials", { email, password, redirect: false })) as
        | { error?: string }
        | undefined;
      if (result?.error) {
        throw new Error("Email o contraseña incorrectos.");
      }
      window.location.href = "/"; // éxito → al juego
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error.");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold">Asentamiento</h1>
      <p className="mb-6 text-sm text-zinc-400">
        {isRegister ? "Crea tu cuenta para empezar a colonizar." : "Entra para gestionar tu asentamiento."}
      </p>

      {googleEnabled && (
        <>
          <button
            onClick={() => signIn("google", { redirectTo: "/" })}
            className="mb-4 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
          >
            Continuar con Google
          </button>
          <div className="mb-4 flex items-center gap-3 text-xs text-zinc-600">
            <span className="h-px flex-1 bg-zinc-800" /> o <span className="h-px flex-1 bg-zinc-800" />
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
        />
        <input
          type="password"
          required
          minLength={isRegister ? 8 : undefined}
          placeholder={isRegister ? "Contraseña (mín. 8 caracteres)" : "Contraseña"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
        />
        {error && <p className="text-sm text-rose-400">⚠️ {error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "…" : isRegister ? "Crear cuenta" : "Entrar"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        {isRegister ? (
          <>¿Ya tienes cuenta? <Link href="/login" className="text-indigo-400 hover:underline">Entra</Link></>
        ) : (
          <>¿No tienes cuenta? <Link href="/register" className="text-indigo-400 hover:underline">Regístrate</Link></>
        )}
      </p>
    </div>
  );
}
