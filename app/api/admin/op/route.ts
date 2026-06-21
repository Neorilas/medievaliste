// POST /api/admin/op — acciones de debug sobre un asentamiento (solo admin).
// body: { settlementId, op, payload? }. La lógica vive en lib/adminOps.ts.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { AdminOpError, applyAdminOp } from "@/lib/adminOps";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  let body: { settlementId?: string; op?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { settlementId, op, payload } = body;
  if (!settlementId || !op) {
    return NextResponse.json({ error: "Faltan settlementId u op." }, { status: 400 });
  }

  try {
    const result = await applyAdminOp(settlementId, op, payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AdminOpError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/admin/op", err);
    return NextResponse.json({ error: "Error al ejecutar la operación." }, { status: 500 });
  }
}
