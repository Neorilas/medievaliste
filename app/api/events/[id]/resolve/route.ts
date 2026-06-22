// POST /api/events/[id]/resolve
// Acepta o rechaza un evento. Body: { action: "accept" | "decline" }. Los tratos
// usan ambas; las inclemencias y la llegada de colonos se "aceptan" (aplican su
// efecto). Devuelve el estado fresco del asentamiento y las hazañas completadas.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";
import { resolveEvent, EventError, type EventAction } from "@/lib/events";

export const dynamic = "force-dynamic";

function parseAction(body: unknown): EventAction | null {
  if (!body || typeof body !== "object") return null;
  const action = (body as Record<string, unknown>).action;
  if (action === "accept" || action === "decline") return action;
  return null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }
  const action = parseAction(body);
  if (!action) {
    return NextResponse.json({ error: "Acción mal formada." }, { status: 400 });
  }

  try {
    const { id } = await ctx.params;
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const { status, newAchievements } = await resolveEvent(settlementId, id, action);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({ status, settlement: view, newAchievements });
  } catch (err) {
    if (err instanceof EventError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/events/[id]/resolve", err);
    return NextResponse.json({ error: "Error al resolver el evento." }, { status: 500 });
  }
}
