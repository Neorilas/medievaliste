# Asentamiento — Diseño Técnico v0

> Documento de referencia para construir el MVP. Pensado para ser consumido por Claude Code.
> Versión 0 (núcleo de gestión, sin geolocalización). Última actualización del diseño: junio 2026.

---

## 0. Resumen ejecutivo

Juego de gestión de colonia para móvil y escritorio, construido como **PWA**. El jugador es líder de un asentamiento: gestiona recursos, asigna colonos a trabajos, cubre las necesidades de su población y hace crecer el asentamiento subiendo el nivel del Ayuntamiento.

Esta v0 es **100% jugable sin GPS ni mapa**. El objetivo único es validar si el bucle de gestión engancha. Toda funcionalidad geolocalizada, social, militar o de alianzas queda **explícitamente fuera** de esta versión, pero el diseño de datos deja los cimientos puestos para no reescribir el núcleo después.

**Principio rector innegociable:** el servidor es la única fuente de verdad. El cliente solo muestra estado y envía acciones. Toda la lógica de juego (producción, consumo, validación de construcción, eventos) se ejecuta y se persiste en el servidor.

---

## 1. Stack técnico

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Framework | Next.js 15 (App Router) | Una sola base de código, móvil + escritorio |
| Empaquetado app | PWA (manifest + service worker) | Instalable en móvil y PC |
| Lenguaje | TypeScript | Tipado estricto en lógica de juego |
| ORM | Prisma | Esquema declarativo, migraciones |
| Base de datos | PostgreSQL | Autogestionada en Hetzner |
| Estilado | Tailwind CSS | Coherente con el resto del stack del autor |
| Autenticación | Auth.js v5 | Ya usado en otros proyectos del autor |
| Notificaciones | Web Push (VAPID) | `web-push` en servidor; service worker en cliente |
| Hosting | Servidor Hetzner propio | Ya operativo |
| Dominio | Por adquirir (~10-12€/año) | HTTPS obligatorio para PWA e iOS push |

### Notas de arquitectura PWA
- El `manifest.json` debe incluir `name`, `icons` (192px y 512px), `start_url` y `display: standalone`.
- El service worker vive en `/public` (su scope depende de su ubicación: raíz).
- **iOS:** las notificaciones push SOLO funcionan si el usuario instala la PWA en su pantalla de inicio, sobre HTTPS con certificado válido. Hay que mostrar un `InstallPrompt` específico que instruya a usuarios de iPhone a "Añadir a inicio". En Android el prompt de instalación es automático.
- Caché: stale-while-revalidate para HTML, cache-first para assets con hash. No se necesita soporte offline complejo en v0 (el juego requiere servidor para todo cálculo).

---

## 2. Principio central: cálculo diferido por timestamps

El juego **no** corre procesos en segundo plano sumando recursos. Toda la producción y el consumo se calculan **bajo demanda**, comparando timestamps.

### Cómo funciona
Cada asentamiento guarda un campo `lastTick` (timestamp de la última vez que se recalculó su estado). Cuando ocurre cualquier interacción (el jugador abre la app, o ejecuta una acción), el servidor ejecuta una función `resolveSettlement(settlementId)` que:

1. Lee el estado actual del asentamiento y su `lastTick`.
2. Calcula `delta = now - lastTick` (tiempo transcurrido).
3. Aplica la **producción** de cada edificio según su tipo, nivel y colonos asignados, durante ese `delta`.
4. Limita cada recurso por la **capacidad del almacén**.
5. Aplica el **consumo** de comida y bienestar de la población durante ese `delta`.
6. Procesa la **cola de eventos** pendientes ocurridos en ese intervalo (plagas, llegada de colono, hambruna).
7. Aplica la lógica de **pérdida de población** si las condiciones se cumplen (ver §5).
8. Aplica la lógica de **crecimiento de población** (máx. 1 colono / 24h, ver §4).
9. Escribe el nuevo estado y actualiza `lastTick = now`.
10. Devuelve el estado fresco + un resumen de lo ocurrido ("mientras no estabas: +120 comida, llegó 1 colono, hubo una plaga").

### Por qué este modelo
- **Barato:** un cálculo por interacción, no miles de ticks por segundo.
- **Escalable:** funciona con 1 o con 100.000 jugadores sin coste de fondo.
- **Robusto:** funciona aunque el jugador cierre la app durante días.
- **Cimiento del multijugador futuro:** el combate asíncrono usará exactamente este mismo motor. Un ataque enemigo se resolverá contra el último estado persistido del defensor y se guardará como un evento en su cola, que se aplicará cuando el defensor reconecte. No se implementa ahora, pero el motor ya lo soporta.

### Reasignación de colonos y tramos
Cuando el jugador reasigna colonos, se debe ejecutar `resolveSettlement` ANTES de aplicar el cambio. Esto "cierra" el tramo de producción con la configuración anterior y abre uno nuevo con la nueva. Así la producción siempre es correcta sin cálculo retroactivo. La reasignación es libre y sin coste (ver §4).

---

## 3. Modelo de datos (esquema Prisma)

```prisma
// Motor: PostgreSQL

model Player {
  id         String     @id @default(cuid())
  email      String     @unique
  createdAt  DateTime   @default(now())
  settlement Settlement?
}

model Settlement {
  id            String      @id @default(cuid())
  player        Player      @relation(fields: [playerId], references: [id])
  playerId      String      @unique
  name          String                            // nombre del asentamiento, definido por el jugador
  townHallLevel Int         @default(1)            // nivel del Ayuntamiento: techo global

  // Recursos (cantidades actuales)
  food          Float       @default(0)
  wood          Float       @default(0)
  stone         Float       @default(0)
  welfare       Float       @default(100)          // bienestar, arranca al 100%

  // Población
  population    Int         @default(3)            // colonos totales (incluye asignados + libres)

  // Motor de cálculo diferido
  lastTick      DateTime    @default(now())

  buildings     Building[]
  events        Event[]

  createdAt     DateTime    @default(now())
}

model Building {
  id            String      @id @default(cuid())
  settlement    Settlement  @relation(fields: [settlementId], references: [id])
  settlementId  String
  type          BuildingType
  level         Int         @default(1)
  workers       Int         @default(0)            // colonos asignados a ESTE edificio

  createdAt     DateTime    @default(now())
}

enum BuildingType {
  TOWN_HALL      // Ayuntamiento: limita nº de edificios y nivel máximo de cada uno
  FARM           // Granja: produce comida (requiere colonos)
  SAWMILL        // Serrería: produce madera (requiere colonos)
  QUARRY         // Cantera: produce piedra (requiere colonos; se desbloquea más tarde)
  HOUSE          // Casa: aumenta capacidad de población
  WAREHOUSE      // Almacén: aumenta topes de almacenamiento
  PLAZA          // Plaza: genera bienestar (requiere colonos)
}

model Event {
  id            String      @id @default(cuid())
  settlement    Settlement  @relation(fields: [settlementId], references: [id])
  settlementId  String
  type          EventType
  payload       Json                                 // datos del efecto, flexible
  occurredAt    DateTime    @default(now())
  seen          Boolean     @default(false)          // si el jugador ya lo vio al reconectar
}

enum EventType {
  COLONIST_ARRIVED
  PLAGUE
  FAMINE            // hambruna: pérdida de población por bienestar bajo
  // Futuro: ATTACKED, ALLIANCE_REQUEST, etc. (no implementar en v0)
}
```

### Decisión clave: colonos como número, no como entidad
La población es una **masa abstracta de individuos idénticos**. NO existe una tabla `Colonist` con una fila por colono. Se modela con números:
- `Settlement.population` = total de colonos.
- `Building.workers` = colonos asignados a cada edificio.
- Colonos libres = `population - SUMA(workers de todos los edificios)`.

Esto simplifica enormemente la v0. La **especialización de colonos** (primera ampliación futura) sí requerirá individualizarlos; por eso es una update, no parte del MVP.

---

## 4. Reglas de juego (configuración, NO base de datos)

Estas reglas viven en archivos de configuración del servidor (`/lib/gameConfig.ts`), no en la base de datos. Son iguales para todos los jugadores y deben poder rebalancearse sin tocar datos de nadie. **Todos los números son valores de partida, a calibrar con pruebas.**

### El Ayuntamiento (TOWN_HALL) — el limitador maestro
El nivel del Ayuntamiento define dos topes globales:
- **Número máximo de edificios** que puede haber en el asentamiento.
- **Nivel máximo** al que puede subir cualquier otro edificio.

Subir el Ayuntamiento es la acción más cara y lenta del juego. Es la espina dorsal de la progresión: el "nivel del asentamiento" ES el nivel del Ayuntamiento. Sin subirlo, no se puede crecer. Esto impide el crecimiento explosivo (no se pueden construir huertos y casas infinitas).

Ejemplo orientativo de tabla de Ayuntamiento:
| Nivel TH | Máx. edificios | Nivel máx. otros edificios | Coste de subida |
|----------|----------------|----------------------------|-----------------|
| 1 | 4 | 2 | — (inicial) |
| 2 | 6 | 3 | mucha madera + piedra |
| 3 | 9 | 4 | más madera + piedra |

### Producción por asignación de colonos
Los edificios **no producen solos**. Producen según cuántos colonos tienen asignados, con **rendimiento creciente** hasta un tope por nivel.

Ejemplo (Granja):
| Colonos asignados | Producción comida/hora |
|-------------------|------------------------|
| 0 | 0 |
| 1 | 2 |
| 2 | 6 |
| ... | hasta tope por nivel del edificio |

El rendimiento más-que-lineal premia concentrar colonos, pero el tope por nivel obliga a construir/mejorar más edificios para crecer. Cada tipo de edificio tiene su propia curva.

### Decisión central del juego: colonos escasos
Hay **más puestos de trabajo que colonos**. El jugador debe elegir constantemente: ¿comida, madera, piedra o bienestar? Esta es la tensión de gestión nuclear. La asignación es **dinámica y libre**: se reasigna cuando se quiera, sin coste.

### Consumo de población
- **Todos los colonos comen**, estén asignados a un trabajo o libres. Consumo orientativo: 1 comida/hora por colono.
- **Todos los colonos consumen bienestar** según el tamaño de población.
- Consecuencia de diseño: la población no es gratis. Cada colono es un par de manos Y una boca. Crecer sin sostener la comida lleva a crisis. El sistema se autorregula con una sola regla: *todos comen*.

### Crecimiento de población
Llega **máximo 1 colono cada 24 horas**, y solo si se cumplen TODAS estas condiciones:
- Hay **vivienda libre** (población < capacidad dada por las casas).
- Hay **excedente de comida** (producción > consumo).
- El **bienestar** está por encima de un umbral mínimo (ej. > 70%).

### Capacidad de almacenamiento
- El **Almacén** define el tope de cada recurso. Sin almacén suficiente, la producción se desperdicia al llenarse.
- **Objetivo de balance:** el almacén debe llenarse en ~12 horas de producción a tasa plena. Esto fija el ritmo de retorno del jugador en dos visitas diarias (mañana/noche). Las tasas de producción y los topes se calibran juntos para cumplir esta ventana.

### Capacidad de población
- Las **Casas** definen cuántos colonos puede albergar el asentamiento. Más casas = más techo de población (limitado a su vez por el Ayuntamiento).

---

## 4-bis. Set de números de partida (para `gameConfig.ts`)

> **Estos números son un punto de partida educado, coherente entre sí, NO la verdad final.** Están calculados para cumplir las dos restricciones duras (almacén lleno en ~12h, 1 colono/24h) y para que el refugio sea autosuficiente desde el minuto cero. El balance real de un idle solo se descubre jugándolo: hay que jugar la v0 unos días y ajustar a mano. Por eso TODO esto vive en `gameConfig.ts`, nunca incrustado en el código.

### Estado inicial del asentamiento
| Parámetro | Valor |
|-----------|-------|
| Población inicial | 3 colonos |
| Bienestar inicial | 100% |
| Capacidad de población base (sin casas) | 3 |
| Comida / Piedra iniciales | 0 |
| Madera inicial | 15 (colchón para la primera construcción) |
| Edificios iniciales | Ayuntamiento N1, Granja N1 |

### Consumo
| Parámetro | Valor |
|-----------|-------|
| Comida por colono | 1 / hora (trabajen o no) |
| Bienestar | drenaje proporcional a la población no cubierta (calibrar jugando) |

### Curvas de producción nivel 1 (colonos asignados → producción/hora)
| Edificio | 0 col | 1 col | 2 col | Recurso |
|----------|-------|-------|-------|---------|
| Granja (FARM) | 0 | 2 | 6 | comida |
| Serrería (SAWMILL) | 0 | 2 | 5 | madera |
| Cantera (QUARRY) | 0 | 2 | 5 | piedra |
| Plaza (PLAZA) | 0 | curva similar | — | bienestar |

Patrón de diseño: el 2º colono rinde MÁS que el 1º (incentiva concentrar), pero hay tope por nivel (obliga a mejorar/construir más para crecer). Cada nivel del edificio sube la curva y el tope.

**Verificación del arranque:** 3 colonos, 2 en la granja → produce 6 comida/h, consume 3/h → superávit +3/h con 1 colono libre. Autosuficiente sin salir. ✓

### Topes de almacén (por recurso, por nivel de Almacén)
| Nivel Almacén | Tope por recurso |
|---------------|------------------|
| 1 | 60 |
| 2 | 150 |
| 3 | 350 |

**Verificación de las 12h:** con tope 60 y producción típica early de 5/h → se llena en 12h. ✓ (a 6/h, 10h; a 3/h, 20h).

### Costes de construcción y mejora
| Acción | Coste |
|--------|-------|
| Construir Casa | 15 madera |
| Construir Plaza | 20 madera |
| Construir Serrería | ~15 madera |
| Construir Cantera | ~20 madera + 10 piedra |
| Granja N1→N2 | 24 madera |
| Serrería N1→N2 | 20 madera |
| Almacén N1→N2 | 30 madera + 10 piedra |

Calibrado para que juntar una mejora cueste entre media sesión y un día de producción. Subir granja a N2 (24 madera) = ~12h con 1 leñador (2/h) o ~5h con 2 (sacrificando comida). Esa tensión es deliberada.

### Ayuntamiento (limitador maestro) — deliberadamente lento
| Nivel TH | Máx. edificios | Nivel máx. otros | Coste de subida |
|----------|----------------|------------------|-----------------|
| 1 | 4 | 2 | — (inicial) |
| 2 | 6 | 3 | 120 madera + 40 piedra |
| 3 | 9 | 4 | 300 madera + 120 piedra |

TH1→TH2 = ~60h con 1 leñador, ~24h con 2 (sacrificando comida). A propósito lento: da al juego un horizonte de **semanas**, no de horas. Si fuera rápido, el jugador se salta toda la curva en una tarde.

### Población
| Parámetro | Valor |
|-----------|-------|
| Capacidad por Casa | +2 colonos |
| Crecimiento | +1 colono / 24h |
| Condiciones de crecimiento | vivienda libre Y superávit de comida Y bienestar > 70% |

### ⚠️ Pieza a calibrar jugando: la curva del bienestar
La generación de bienestar de la Plaza (por colono) y su drenaje por población es lo más difícil de calibrar sobre papel, porque interactúa con todo (población, comida, eventos de plaga). **Arrancar simple:** la Plaza con 1 colono mantiene el bienestar estable para la población que la comida puede sostener. Afinar en cuanto se pueda probar en movimiento. No fijar números firmes aquí hasta verlo jugando.

---

## 5. Pérdida de población (reglas justas y avisadas)

La pérdida de colonos es siempre la ÚLTIMA consecuencia de una cadena avisada, nunca una sorpresa. El jugador siempre ve su bienestar, así que siempre sabe a qué distancia está del peligro.

**Cadena de crisis:**
1. La comida llega a cero y persiste el déficit.
2. El **bienestar empieza a bajar** (zona de aviso, claramente visible en la interfaz).
3. Mientras el bienestar esté **por encima del 70%**, NO se pierde a nadie.
4. Si el bienestar cae **por debajo del 70%** y se mantiene así, se empieza a perder colonos **uno a uno** (nunca de golpe).

El 70% es una línea roja explícita y comprensible. La pérdida se registra como un evento `FAMINE`.

---

## 6. Eventos

Los eventos son la cola de cosas que ocurren mientras el jugador no está, y que ve al reconectar. En v0 son internos:
- `COLONIST_ARRIVED`: llegó un colono nuevo.
- `PLAGUE`: una plaga/enfermedad presiona el bienestar a la baja durante un periodo. Crea una mini-crisis gestionable (mover colonos a la plaza para compensar, por ejemplo).
- `FAMINE`: se perdió población por bienestar bajo sostenido.

La tabla `Event` es la MISMA que un día recibirá eventos multijugador (`ATTACKED`, etc.). Cimiento del juego asíncrono futuro, puesto desde ya sin construir nada militar.

---

## 7. Flujo de una sesión (recorrido completo)

1. El jugador abre la PWA.
2. El cliente pide a `/api/settlement` el estado de su asentamiento.
3. El servidor ejecuta `resolveSettlement()`: calcula producción/consumo diferido, procesa eventos, actualiza recursos y población, guarda nuevo `lastTick`.
4. Devuelve estado fresco + resumen de lo ocurrido.
5. El jugador ve sus recursos al día, su población, su bienestar, y el resumen.
6. El jugador ejecuta una acción (ej. "subir Granja a nivel 2", o "asignar 2 colonos a la Serrería").
7. El cliente envía la acción al servidor.
8. El servidor: ejecuta `resolveSettlement()` primero (cierra tramo), **valida** que la acción es legal (¿hay recursos suficientes? ¿lo permite el nivel del Ayuntamiento? ¿hay colonos libres?), la aplica, guarda.
9. Devuelve el nuevo estado. El cliente repinta.

Toda validación ocurre en el servidor. El cliente nunca calcula recursos ni decide qué es legal.

---

## 8. Estructura de proyecto sugerida

```
/app
  /api
    /settlement      → GET estado (ejecuta resolveSettlement)
    /actions         → POST acciones (build, upgrade, assign)
    /web-push        → suscripción y envío de notificaciones
  /(game)            → interfaz del juego (cliente)
  page.tsx           → entrada / InstallPrompt
/lib
  gameConfig.ts      → TODAS las reglas y números de balance
  resolveSettlement.ts → motor de cálculo diferido (corazón del juego)
  validation.ts      → validación de acciones legales
/prisma
  schema.prisma
/public
  manifest.json
  sw.js              → service worker (push + caché)
  /icons             → 192px, 512px
```

---

## 9. Fuera de alcance en v0 (explícito)

NO construir nada de esto ahora. Listado para tenerlo presente y no cerrar puertas en el diseño:
- Geolocalización, mapa, GPS, recolección por movimiento.
- POIs reales o sugeridos por usuarios.
- Especialización de colonos (primera ampliación prevista).
- Asignación de trabajos con experiencia/roles.
- Multijugador: ver otros asentamientos, alianzas, gestión de aliados.
- Combate, guerras, vasallaje, tropas.
- Comercio o transferencia de recursos entre asentamientos.
- Monetización (rewarded ads, compras).

---

## 10. Roadmap de cimientos (qué deja preparado este diseño)

| Cimiento puesto en v0 | Qué desbloquea en el futuro |
|------------------------|------------------------------|
| Servidor como fuente de verdad + cálculo diferido | Combate asíncrono (resolver contra estado persistido) |
| Tabla `Event` con `payload` JSON flexible | Recibir ataques, peticiones de alianza, tributos |
| `Settlement` con identidad y nombre propios | Existencia de múltiples asentamientos relacionables |
| Población como número agregado | Enviar colonos como tropa / cederlos a un vasallo |
| Recursos en modelo transferible | Comercio, tributo, saqueo |
| Nivel de Ayuntamiento como techo global | Determinar nº de alianzas, tropas, rango de señor |

---

## 11. Primeras tareas de construcción (orden sugerido para Claude Code)

1. Inicializar proyecto Next.js 15 + TypeScript + Tailwind + Prisma.
2. Configurar PostgreSQL en Hetzner y conectar Prisma.
3. Definir el `schema.prisma` (§3) y correr la primera migración.
4. Escribir `gameConfig.ts` con los números de balance (§4).
5. Escribir `resolveSettlement.ts` — el motor de cálculo diferido (§2). **Es el corazón; testearlo bien.**
6. Crear los endpoints `/api/settlement` (GET) y `/api/actions` (POST) con validación servidor.
7. Construir la interfaz mínima: ver recursos, población, edificios; botones de construir/mejorar/asignar.
8. Convertir en PWA: manifest, service worker, InstallPrompt (con caso iOS).
9. (Último) Notificaciones web push para avisos de retención.

**Recomendación de testing:** el motor `resolveSettlement` concentra toda la complejidad y todos los bugs potenciales (timestamps, topes, consumo, crisis). Merece tests unitarios sólidos antes de construir la interfaz encima.
