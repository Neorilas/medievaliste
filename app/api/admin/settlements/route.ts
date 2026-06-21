// GET /api/admin/settlements — lista todos los asentamientos con su detalle.
// Solo accesible para emails en ADMIN_EMAILS.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const settlements = await prisma.settlement.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { email: true } },
      buildings: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { occurredAt: "desc" }, take: 10 },
    },
  });

  return NextResponse.json({
    settlements: settlements.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.user.email,
      townHallLevel: s.townHallLevel,
      food: s.food,
      wood: s.wood,
      stone: s.stone,
      welfare: s.welfare,
      population: s.population,
      growthProgress: s.growthProgress,
      famineProgress: s.famineProgress,
      lastTick: s.lastTick.toISOString(),
      buildings: s.buildings.map((b) => ({
        id: b.id,
        type: b.type,
        level: b.level,
        workers: b.workers,
      })),
      events: s.events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt.toISOString(),
        seen: e.seen,
      })),
    })),
  });
}
