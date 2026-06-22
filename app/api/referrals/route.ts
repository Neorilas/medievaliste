// GET /api/referrals
// Estado de referidos del usuario: su enlace, la lista de invitados y el total de
// recompensas recibidas por los que ya se activaron (llegaron a Ayuntamiento N2).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { REFERRAL_REWARD, referralLink } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/** Nombre visible de un referido: username o, si no, la parte local del email. */
function displayName(username: string | null, email: string): string {
  return username ?? email.split("@")[0];
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: {
        referralCode: true,
        referrals: {
          select: {
            username: true,
            email: true,
            createdAt: true,
            referralRewardAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    const referrals = me.referrals.map((r) => ({
      username: displayName(r.username, r.email),
      joinedAt: r.createdAt.toISOString(),
      activated: r.referralRewardAt !== null,
      rewardDeliveredAt: r.referralRewardAt?.toISOString() ?? null,
    }));
    const totalActivated = referrals.filter((r) => r.activated).length;

    return NextResponse.json({
      referralCode: me.referralCode,
      referralLink: referralLink(me.referralCode),
      referrals,
      totalActivated,
      totalRewardReceived: {
        wood: totalActivated * REFERRAL_REWARD.wood,
        food: totalActivated * REFERRAL_REWARD.food,
        stone: totalActivated * REFERRAL_REWARD.stone,
      },
    });
  } catch (err) {
    console.error("GET /api/referrals", err);
    return NextResponse.json({ error: "Error al cargar los referidos." }, { status: 500 });
  }
}
