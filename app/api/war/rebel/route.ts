// POST /api/war/rebel — un vasallo se rebela contra su señor (§1.5). Sin cuerpo:
// el atacante es el asentamiento del usuario. Solo procede si su fuerza supera la
// del señor. Devuelve el resultado de la batalla y la vista refrescada.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";
import { declareRebellion, WarfareError } from "@/lib/warfare";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const result = await declareRebellion(settlementId);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({ result, settlement: view });
  } catch (err) {
    if (err instanceof WarfareError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/war/rebel", err);
    return NextResponse.json({ error: "Error al rebelarse." }, { status: 500 });
  }
}
