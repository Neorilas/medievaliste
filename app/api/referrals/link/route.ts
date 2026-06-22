// GET /api/referrals/link
// Solo el enlace de invitación del usuario, para el botón de copiar/compartir.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { referralLink } from "@/lib/referrals";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { referralCode: true },
    });
    return NextResponse.json({ referralLink: referralLink(me.referralCode) });
  } catch (err) {
    console.error("GET /api/referrals/link", err);
    return NextResponse.json({ error: "Error al generar el enlace." }, { status: 500 });
  }
}
