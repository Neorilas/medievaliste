// GET /api/events/pending
// Devuelve el evento aleatorio activo (PENDING) si existe, generando uno nuevo si
// procede (generación diferida, sin cron). El cliente solo lo muestra.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateSettlementForUser } from "@/lib/settlement";
import { generateEventIfDue, describeEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const event = await generateEventIfDue(settlementId);
    return NextResponse.json({ event: event ? describeEvent(event) : null });
  } catch (err) {
    console.error("GET /api/events/pending", err);
    return NextResponse.json({ error: "Error al cargar los eventos." }, { status: 500 });
  }
}
