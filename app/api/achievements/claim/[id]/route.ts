// POST /api/achievements/claim/[id]
// Canje manual de la recompensa de una hazaña completada. Verifica propiedad y que
// no esté ya reclamada; en una transacción aplica los recursos al asentamiento y
// escribe claimedAt. Devuelve la recompensa entregada para el feedback en la UI.
//   404 → la hazaña no existe o no pertenece al jugador
//   409 → ya fue reclamada
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { claimAchievement, ClaimError } from "@/lib/achievements";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;
    const reward = await claimAchievement(session.user.id, id);
    return NextResponse.json({ reward });
  } catch (err) {
    if (err instanceof ClaimError) {
      if (err.reason === "already_claimed") {
        return NextResponse.json({ error: "La recompensa ya fue reclamada." }, { status: 409 });
      }
      return NextResponse.json({ error: "Hazaña no encontrada." }, { status: 404 });
    }
    console.error("POST /api/achievements/claim/[id]", err);
    return NextResponse.json({ error: "Error al reclamar la recompensa." }, { status: 500 });
  }
}
