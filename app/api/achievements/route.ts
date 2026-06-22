// GET /api/achievements
// Estado de todas las hazañas del usuario: completadas, disponibles y bloqueadas.
// Las disponibles/completadas incluyen progreso actual vs objetivo para la UI.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateSettlementForUser } from "@/lib/settlement";
import { categorizeAchievements, currentValues } from "@/lib/achievements";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: { buildings: true },
    });
    const done = await prisma.userAchievement.findMany({
      where: { userId: session.user.id },
      select: { achievementId: true, completedAt: true, claimedAt: true },
    });
    const completedMap = new Map(
      done.map((d) => [
        d.achievementId,
        { completedAt: d.completedAt, claimedAt: d.claimedAt },
      ]),
    );
    const values = currentValues(settlement);
    return NextResponse.json(categorizeAchievements(completedMap, values));
  } catch (err) {
    console.error("GET /api/achievements", err);
    return NextResponse.json({ error: "Error al cargar las hazañas." }, { status: 500 });
  }
}
