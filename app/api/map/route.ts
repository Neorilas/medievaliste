// GET /api/map — tablero 2D de la región del jugador (propio + otros + neutrales).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser } from "@/lib/settlement";
import { getRegionMap } from "@/lib/map";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const map = await getRegionMap(settlementId);
    if (!map) {
      return NextResponse.json({ error: "Aún no has elegido región." }, { status: 409 });
    }
    return NextResponse.json({ map });
  } catch (err) {
    console.error("GET /api/map", err);
    return NextResponse.json({ error: "Error al cargar el mapa." }, { status: 500 });
  }
}
