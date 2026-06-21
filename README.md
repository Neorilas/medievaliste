# Asentamiento — v0

Juego de gestión de colonia (PWA, móvil + escritorio). El servidor es la única
fuente de verdad; el cliente solo muestra estado y envía acciones. Toda la
producción/consumo se calcula **bajo demanda** comparando timestamps (motor de
cálculo diferido). Diseño completo en [`.claude/DISENO_TECNICO_v0.md`](.claude/DISENO_TECNICO_v0.md).

## Stack

Next.js 16 (App Router) · TypeScript · Prisma 7 · PostgreSQL · Tailwind · Vitest.

> El diseño pedía Next.js 15; `create-next-app` instaló la 16 (vigente). App
> Router y PWA son equivalentes, así que se mantiene la 16.

## Puesta en marcha (desarrollo)

Requiere Node 22+ y Docker Desktop **corriendo**.

```bash
npm install
npm run db:up        # levanta Postgres en Docker (docker-compose.yml)
npm run db:migrate   # crea las tablas (primera vez: nombra la migración, p.ej. "init")
npm run dev          # http://localhost:3000
```

La conexión vive en `.env` (`DATABASE_URL`). En producción se apunta al Postgres
de Hetzner cambiando solo esa variable.

## Despliegue (Vercel + Neon)

1. **Base de datos (Neon)**: crea un proyecto en [neon.tech](https://neon.tech) y
   copia la cadena de conexión **directa** (sin `-pooler`). Tráfico bajo → no hace
   falta el pooler, y `prisma migrate deploy` no funciona bien contra PgBouncer.
2. **Variables en Vercel** (Project → Settings → Environment Variables, los tres
   entornos): `DATABASE_URL` (Neon), `AUTH_SECRET` (genera uno nuevo, distinto al
   de local), `AUTH_TRUST_HOST=true`, `ADMIN_EMAILS` (tu email). Google OAuth es
   opcional (`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`).
3. **Redeploy**: el `build` (`prisma migrate deploy && next build`) crea las tablas
   en Neon y el `postinstall` (`prisma generate`) genera el cliente. Importante:
   define las variables **antes** de desplegar, o el build falla al no encontrar
   `DATABASE_URL`.

### Comandos útiles

| Comando | Qué hace |
|---------|----------|
| `npm test` | Tests unitarios del motor y la validación (no necesitan DB) |
| `npm run db:studio` | Explorador visual de la base de datos |
| `npm run db:reset` | Borra y recrea la base (¡destructivo!) |
| `npm run lint` | ESLint |

## Arquitectura

```
/lib
  gameConfig.ts        → TODOS los números de balance (calibrar jugando)
  resolveSettlement.ts → motor de cálculo diferido (función pura `simulate` + wrapper DB)
  validation.ts        → validación pura de acciones legales
  actions.ts           → aplica acciones (resolver → validar → aplicar, atómico)
  settlement.ts        → bootstrap + vista de estado para el cliente
  prisma.ts            → singleton del cliente Prisma (adapter pg)
  admin.ts             → autorización del panel de admin (lista blanca ADMIN_EMAILS)
auth.ts / auth.config.ts → configuración de Auth.js (completa / edge-safe)
middleware.ts          → protege páginas (sin sesión → /login)
/app/api
  /settlement (GET)    → resuelve estado diferido + devuelve estado fresco y resumen
  /actions    (POST)   → aplica una acción { kind: "build"|"upgrade"|"upgradeTownHall"|"assign", ... }
  /register   (POST)   → alta con email/contraseña
  /auth/...            → endpoints de Auth.js
  /admin/...           → listado y acciones de debug (solo admin)
/app/login, /app/register, /app/admin → pantallas
/prisma/schema.prisma  → modelo de datos (User/Account/Session + Settlement/Building/Event)
```

El corazón es `simulate()` en `resolveSettlement.ts`: función pura y determinista,
cubierta por tests unitarios (timestamps, topes de almacén, consumo, crecimiento,
hambruna, plaga).

## Estado actual (v0 en construcción)

Hecho:
- Esquema de datos + motor diferido + validación + endpoints (backend completo).
- Interfaz del juego (cliente) en `app/page.tsx`: recursos, población, bienestar,
  asignación de colonos, construir/mejorar, subir Ayuntamiento, resumen "mientras
  no estabas".
- **Auth.js v5** (login/registro con email-contraseña y Google opcional). Cada
  usuario tiene su asentamiento aislado; rutas protegidas por middleware.
- **Panel de admin** (`/admin`, solo `ADMIN_EMAILS`): lista de asentamientos +
  acciones de debug (dar recursos, fijar población/bienestar, resolver, plaga, reset).
- Todo verificado end-to-end en el navegador. 38 tests; typecheck y lint limpios.

Pendiente:
- Despliegue (Vercel + Postgres gestionada) para testear con jugadores reales.
- Login con Google: código listo, falta crear el OAuth Client y rellenar `AUTH_GOOGLE_ID/SECRET`.
- PWA: manifest, service worker, InstallPrompt (caso iOS).
- Notificaciones Web Push.
- Tutorial / onboarding (no definido en el diseño; pendiente de decidir).

## Desviaciones respecto al diseño v0

- **Next.js 16** en vez de 15 (lo que instala `create-next-app` hoy).
- Dos campos extra en `Settlement`: `growthProgress` y `famineProgress`. El motor
  diferido los necesita para no reiniciar el progreso de crecimiento/hambruna en
  cada interacción (sin ellos, abrir la app a menudo bloquearía ambos).
- `welfareDrainPerColonistPerHour` arranca en **0**: el bienestar solo cae por
  hambre o plaga, dejando el arranque (sin Plaza) autosuficiente, como pide §4-bis
  ("arrancar simple"). Es el knob principal a calibrar jugando.
