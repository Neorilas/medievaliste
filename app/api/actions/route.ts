// POST /api/actions
// Aplica una acción del jugador. El servidor resuelve el tramo, valida la
// legalidad y aplica el cambio (todo en una transacción). Devuelve estado fresco.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ActionError, applyAction } from "@/lib/actions";
import { getOrCreateSettlementForUser, getSettlementView } from "@/lib/settlement";
import type { Action } from "@/lib/validation";
import { BuildingType } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

const BUILDING_TYPES = new Set<string>(Object.values(BuildingType));

/** Convierte el cuerpo crudo en una Action tipada, o null si es inválido. */
function parseAction(body: unknown): Action | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  switch (b.kind) {
    case "assign":
      if (typeof b.buildingId === "string" && typeof b.workers === "number") {
        return { kind: "assign", buildingId: b.buildingId, workers: b.workers };
      }
      return null;
    case "build":
      if (typeof b.buildingType === "string" && BUILDING_TYPES.has(b.buildingType)) {
        return { kind: "build", buildingType: b.buildingType as BuildingType };
      }
      return null;
    case "upgrade":
      if (typeof b.buildingId === "string") {
        return { kind: "upgrade", buildingId: b.buildingId };
      }
      return null;
    case "cancelConstruction":
      if (typeof b.buildingId === "string") {
        return { kind: "cancelConstruction", buildingId: b.buildingId };
      }
      return null;
    case "upgradeTownHall":
      return { kind: "upgradeTownHall" };
    default:
      return null;
  }
}

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

  const action = parseAction(body);
  if (!action) {
    return NextResponse.json({ error: "Acción mal formada." }, { status: 400 });
  }

  try {
    const settlementId = await getOrCreateSettlementForUser(session.user.id);
    const { summary, newAchievements, referralActivated } = await applyAction(settlementId, action);
    const view = await getSettlementView(settlementId);
    return NextResponse.json({ settlement: view, summary, newAchievements, referralActivated });
  } catch (err) {
    if (err instanceof ActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/actions", err);
    return NextResponse.json({ error: "Error al aplicar la acción." }, { status: 500 });
  }
}
