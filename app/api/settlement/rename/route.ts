// POST /api/settlement/rename — cambia el nombre del asentamiento (1 vez/24h).
// Body: { name: string }. Si el cooldown sigue activo devuelve 429 con retryAfter.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";
import { IdentityError, renameSettlement } from "@/lib/settlementIdentity";

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
  const name = typeof (body as Record<string, unknown>)?.name === "string"
    ? ((body as Record<string, unknown>).name as string)
    : "";

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    await renameSettlement(settlementId, name);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({ settlement: view });
  } catch (err) {
    if (err instanceof IdentityError) {
      const payload: Record<string, unknown> = { error: err.message };
      if (err.retryAfterSeconds !== undefined) payload.retryAfter = err.retryAfterSeconds;
      return NextResponse.json(payload, { status: err.status });
    }
    console.error("POST /api/settlement/rename", err);
    return NextResponse.json({ error: "Error al renombrar." }, { status: 500 });
  }
}
