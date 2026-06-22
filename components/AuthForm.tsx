"use client";

// Formulario de acceso reutilizable para /login y /register.
// - Registro: email + nombre de usuario + contraseña → /api/register y luego inicia sesión.
// - Login: un solo campo "email o nombre de usuario" + contraseña.
// - Google: solo si está configurado en el servidor (googleEnabled).

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
} from "@/lib/accountValidation";
import { REFERRAL_STORAGE_KEY } from "@/app/join/page";

export function AuthForm({ mode, googleEnabled }: { mode: "login" | "register"; googleEnabled: boolean }) {
  const isRegister = mode === "register";

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState(""); // login: email o username
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null); // "email" | "username" | "password"
  const [busy, setBusy] = useState(false);
  // Código de referido guardado por /join (si el usuario llegó por una invitación).
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    if (!isRegister) return;
    try {
      setRef(sessionStorage.getItem(REFERRAL_STORAGE_KEY));
    } catch {
      // sessionStorage no disponible: registro normal sin referido.
    }
  }, [isRegister]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      if (isRegister) {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, username, password, ref: ref ?? undefined }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (typeof data.field === "string") setFieldError(data.field);
          throw new Error(data.error ?? "No se pudo crear la cuenta.");
        }
        // Registro correcto: el código de referido ya se usó, lo limpiamos.
        try {
          sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
        } catch {
          // ignorar
        }
      }
      // Inicia sesión con credenciales. En registro, el identificador es el email.
      const result = (await signIn("credentials", {
        identifier: isRegister ? email : identifier,
        password,
        redirect: false,
      })) as { error?: string } | undefined;
      if (result?.error) {
        throw new Error(
          isRegister
            ? "Cuenta creada, pero no se pudo iniciar sesión. Prueba a entrar."
            : "Email/usuario o contraseña incorrectos.",
        );
      }
      window.location.href = "/"; // éxito → al juego (u onboarding)
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error.");
      setBusy(false);
    }
  }

  const inputClass =
    "rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-indigo-500";
  const errorInputClass =
    "rounded-lg border border-rose-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-rose-500";

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold">Asentamiento</h1>
      <p className="mb-6 text-sm text-zinc-400">
        {isRegister ? "Crea tu cuenta para empezar a colonizar." : "Entra para gestionar tu asentamiento."}
      </p>

      {isRegister && ref && (
        <p className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          🎁 Te unes con una invitación: empezarás con 25 de madera, comida y piedra.
        </p>
      )}

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
        {isRegister ? (
          <>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldError === "email" ? errorInputClass : inputClass}
            />
            <input
              type="text"
              required
              minLength={USERNAME_MIN}
              maxLength={USERNAME_MAX}
              placeholder={`Nombre de usuario (${USERNAME_MIN}–${USERNAME_MAX}, letras, números, _ -)`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={fieldError === "username" ? errorInputClass : inputClass}
            />
          </>
        ) : (
          <input
            type="text"
            required
            placeholder="Email o nombre de usuario"
            autoCapitalize="none"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className={inputClass}
          />
        )}
        <input
          type="password"
          required
          minLength={isRegister ? PASSWORD_MIN : undefined}
          placeholder={isRegister ? `Contraseña (mín. ${PASSWORD_MIN} caracteres)` : "Contraseña"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={fieldError === "password" ? errorInputClass : inputClass}
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
