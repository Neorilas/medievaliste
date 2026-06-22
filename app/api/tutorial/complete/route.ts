// POST /api/tutorial/complete — marca un paso del tutorial como visto (Cambio C).
// Body: { stepId: string }. Persiste tutorialProgress[stepId] = true en BD.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateSettlementForUser } from "@/lib/settlement";
import { isTutorialStepId, parseTutorialProgress } from "@/lib/tutorial";

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
  const stepId = (body as Record<string, unknown>)?.stepId;
  if (!isTutorialStepId(stepId)) {
    return NextResponse.json({ error: "Paso de tutorial desconocido." }, { status: 400 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const current = await prisma.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      select: { tutorialProgress: true },
    });
    const progress = parseTutorialProgress(current.tutorialProgress);
    progress[stepId] = true;
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { tutorialProgress: progress },
    });
    return NextResponse.json({ tutorialProgress: progress });
  } catch (err) {
    console.error("POST /api/tutorial/complete", err);
    return NextResponse.json({ error: "Error al guardar el tutorial." }, { status: 500 });
  }
}
