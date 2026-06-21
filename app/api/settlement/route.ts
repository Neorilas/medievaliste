// GET /api/settlement
// Punto de entrada al abrir la app: ejecuta resolveSettlement (cálculo diferido),
// y devuelve el estado fresco + un resumen de lo ocurrido mientras no estabas.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { resolveSettlement } from "@/lib/resolveSettlement";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const { summary } = await resolveSettlement(settlementId);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({
      settlement: view,
      summary,
      player: {
        email: session.user.email,
        name: session.user.name,
        isAdmin: isAdminEmail(session.user.email),
      },
    });
  } catch (err) {
    console.error("GET /api/settlement", err);
    return NextResponse.json({ error: "Error al cargar el asentamiento." }, { status: 500 });
  }
}
