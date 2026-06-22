// POST /api/war/declare — declara guerra a otro asentamiento de tu región (§1.2).
// Body: { defenderId: string }. La resolución es inmediata por stats; devuelve el
// resultado de la batalla y la vista refrescada del atacante.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";
import { declareWar, WarfareError } from "@/lib/warfare";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
  const defenderId = (body as Record<string, unknown>)?.defenderId;
  if (typeof defenderId !== "string" || defenderId.length === 0) {
    return NextResponse.json({ error: "Falta el objetivo (defenderId)." }, { status: 400 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const result = await declareWar(settlementId, defenderId);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({ result, settlement: view });
  } catch (err) {
    if (err instanceof WarfareError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/war/declare", err);
    return NextResponse.json({ error: "Error al declarar la guerra." }, { status: 500 });
  }
}
