// Utilidades compartidas por los tests de integración.
import { prisma } from "../../lib/prisma";
import { getOrCreateSettlementForUser } from "../../lib/settlement";

export { prisma };

const TABLES = [
  "WarDeclaration",
  "Vassalage",
  "Event",
  "Building",
  "Settlement",
  "Session",
  "Account",
  "VerificationToken",
  "User",
];

/** Vacía todas las tablas. Llamar en beforeEach para aislar cada test. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

let seq = 0;

/** Crea un usuario con email único. */
export async function createUser(email?: string) {
  seq += 1;
  return prisma.user.create({
    data: { email: email ?? `player${seq}@test.com` },
    select: { id: true, email: true },
  });
}

/** Crea un usuario y su asentamiento inicial; devuelve ambos ids. */
export async function createUserWithSettlement() {
  const user = await createUser();
  const settlementId = await getOrCreateSettlementForUser(user.id);
  return { userId: user.id, settlementId, email: user.email };
}

/** Mueve el lastTick del asentamiento `hours` horas hacia atrás (para simular tiempo transcurrido). */
export async function rewindLastTick(settlementId: string, hours: number) {
  const past = new Date(Date.now() - hours * 60 * 60 * 1000);
  await prisma.settlement.update({ where: { id: settlementId }, data: { lastTick: past } });
}
