// POST /api/settlement/region — fija la región del asentamiento (onboarding).
// Body: { region: Region }. Permanente: si ya estaba fijada devuelve 409.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";
import { IdentityError, setSettlementRegion } from "@/lib/settlementIdentity";
import { isRegion } from "@/lib/regionConfig";

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
  const region = (body as Record<string, unknown>)?.region;
  if (!isRegion(region)) {
    return NextResponse.json({ error: "Región no válida." }, { status: 400 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    await setSettlementRegion(settlementId, region);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({ settlement: view });
  } catch (err) {
    if (err instanceof IdentityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/settlement/region", err);
    return NextResponse.json({ error: "Error al fijar la región." }, { status: 500 });
  }
}
