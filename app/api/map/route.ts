// GET /api/map — tablero 2D de una región (propio + otros + neutrales).
// Sin parámetros: la región del jugador. Con `?region=X`: la región X (Cambio B3,
// exploración de regiones ajenas; en ese caso sin asentamiento propio).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser } from "@/lib/settlement";
import { getRegionMap } from "@/lib/map";
import { isRegion } from "@/lib/regionConfig";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const regionParam = new URL(req.url).searchParams.get("region");
  if (regionParam && !isRegion(regionParam)) {
    return NextResponse.json({ error: "Región no válida." }, { status: 400 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const region = isRegion(regionParam) ? regionParam : undefined;
    const map = await getRegionMap(settlementId, region);
    if (!map) {
      return NextResponse.json({ error: "Aún no has elegido región." }, { status: 409 });
    }
    return NextResponse.json({ map });
  } catch (err) {
    console.error("GET /api/map", err);
    return NextResponse.json({ error: "Error al cargar el mapa." }, { status: 500 });
  }
}
