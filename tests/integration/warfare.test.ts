import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithSettlement, prisma, resetDb } from "./helpers";
import { declareRebellion, declareWar, WarfareError } from "../../lib/warfare";
import { Region } from "../../lib/generated/prisma/enums";

beforeEach(resetDb);

// Crea un asentamiento listo para guerrear: con región y posición fijas y una
// antigüedad que lo saca de la inmunidad de novato salvo que se pida lo contrario.
// La fuerza militar se controla con la MURALLA (40/nivel), que no depende del tope
// de almacén ni de los colonos, así que sobrevive intacta al cálculo diferido.
async function makeSettlement(opts: {
  wallLevel?: number;
  ageDays?: number;
  region?: Region;
} = {}): Promise<string> {
  const { settlementId } = await createUserWithSettlement();
  await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      region: opts.region ?? Region.BAETICA,
      posX: 50,
      posY: 50,
      createdAt: new Date(Date.now() - (opts.ageDays ?? 30) * 24 * 60 * 60 * 1000),
      lastTick: new Date(),
    },
  });
  if (opts.wallLevel && opts.wallLevel > 0) {
    await setWall(settlementId, opts.wallLevel);
  }
  return settlementId;
}

/** Da (o sube) una Muralla a un asentamiento para fijar su fuerza militar. */
async function setWall(settlementId: string, level: number) {
  await prisma.building.create({
    data: { settlementId, type: "WALL", level, workers: 0 },
  });
}

const vassalageOf = (vassalId: string) =>
  prisma.vassalage.findUnique({ where: { vassalId } });

describe("conquista y vasallaje (Bloque 6, §1)", () => {
  it("el atacante con más fuerza conquista: el defensor pasa a ser vasallo con tributo", async () => {
    const attacker = await makeSettlement({ wallLevel: 2 }); // fuerza 80
    const defender = await makeSettlement({ wallLevel: 0 }); // fuerza 0

    const result = await declareWar(attacker, defender);

    expect(result.attackerWon).toBe(true);
    expect(result.outcome).toBe("conquered");

    const v = await vassalageOf(defender);
    expect(v).not.toBeNull();
    expect(v!.lordId).toBe(attacker);
    expect(v!.tributePct).toBe(15);
  });

  it("en empate gana el defensor: no hay conquista", async () => {
    const attacker = await makeSettlement({ wallLevel: 0 });
    const defender = await makeSettlement({ wallLevel: 0 });

    const result = await declareWar(attacker, defender);

    expect(result.attackerWon).toBe(false);
    expect(result.outcome).toBe("defended");
    expect(await vassalageOf(defender)).toBeNull();
  });

  it("la inmunidad de novato bloquea el ataque", async () => {
    const attacker = await makeSettlement({ wallLevel: 2 });
    const defender = await makeSettlement({ wallLevel: 0, ageDays: 1 }); // inmune

    await expect(declareWar(attacker, defender)).rejects.toBeInstanceOf(WarfareError);
    expect(await vassalageOf(defender)).toBeNull();
  });

  it("no se puede atacar a un asentamiento de otra región", async () => {
    const attacker = await makeSettlement({ wallLevel: 2, region: Region.BAETICA });
    const defender = await makeSettlement({ wallLevel: 0, region: Region.LUSITANIA });

    await expect(declareWar(attacker, defender)).rejects.toThrow(/región/i);
  });

  it("el cooldown impide reatacar al mismo defensor en la ventana de 48h", async () => {
    const attacker = await makeSettlement({ wallLevel: 0 }); // empata → defiende
    const defender = await makeSettlement({ wallLevel: 0 });

    await declareWar(attacker, defender); // primera (defendida)
    await expect(declareWar(attacker, defender)).rejects.toBeInstanceOf(WarfareError);
  });

  it("un vasallo no puede declarar guerra (solo rebelarse)", async () => {
    const lord = await makeSettlement({ wallLevel: 2 });
    const vassal = await makeSettlement({ wallLevel: 0 });
    const third = await makeSettlement({ wallLevel: 0 });

    await declareWar(lord, vassal); // vassal queda vasallo de lord
    await expect(declareWar(vassal, third)).rejects.toThrow(/vasallo/i);
  });

  it("al conquistar a un señor, sus vasallos se liberan (cascada, §1.6)", async () => {
    const a = await makeSettlement({ wallLevel: 3 }); // fuerza 120
    const b = await makeSettlement({ wallLevel: 1 }); // fuerza 40
    const c = await makeSettlement({ wallLevel: 0 }); // fuerza 0

    await declareWar(b, c); // B conquista a C → C vasallo de B
    expect((await vassalageOf(c))!.lordId).toBe(b);

    await declareWar(a, b); // A conquista a B (señor) → C se libera

    expect((await vassalageOf(b))!.lordId).toBe(a); // B ahora es vasallo de A
    expect(await vassalageOf(c)).toBeNull(); // C liberado (jerarquía plana)
  });
});

describe("rebelión (Bloque 6, §1.5)", () => {
  it("si la fuerza del vasallo supera la del señor, la rebelión lo libera", async () => {
    const lord = await makeSettlement({ wallLevel: 1 }); // fuerza 40
    const vassal = await makeSettlement({ wallLevel: 0 });
    await declareWar(lord, vassal);
    expect(await vassalageOf(vassal)).not.toBeNull();

    // El vasallo se rearma (Muralla N2 = 80 > 40) hasta superar a su señor.
    await setWall(vassal, 2);

    const result = await declareRebellion(vassal);
    expect(result.isRebellion).toBe(true);
    expect(result.attackerWon).toBe(true);
    expect(result.outcome).toBe("freed");
    expect(await vassalageOf(vassal)).toBeNull(); // libre
  });

  it("la rebelión se bloquea si el vasallo no supera al señor", async () => {
    const lord = await makeSettlement({ wallLevel: 1 });
    const vassal = await makeSettlement({ wallLevel: 0 });
    await declareWar(lord, vassal);

    await expect(declareRebellion(vassal)).rejects.toBeInstanceOf(WarfareError);
    expect(await vassalageOf(vassal)).not.toBeNull(); // sigue siendo vasallo
  });

  it("un asentamiento libre no puede rebelarse", async () => {
    const free = await makeSettlement({ wallLevel: 1 });
    await expect(declareRebellion(free)).rejects.toThrow(/vasallo/i);
  });
});

describe("tributo al señor (Bloque 6, §1.4)", () => {
  it("al resolver el tramo del vasallo, el señor recibe su parte de la producción", async () => {
    const lord = await makeSettlement({ wallLevel: 2 });
    const vassal = await makeSettlement({ wallLevel: 0 });
    await declareWar(lord, vassal);

    // El vasallo se hace autosuficiente y produce madera 10h. Población 5 para alojar
    // los 4 colonos (Granja 2 + Serrería 2) sin que la Granja pierda puestos.
    await prisma.building.create({
      data: { settlementId: vassal, type: "SAWMILL", level: 1, workers: 2 },
    });
    await prisma.settlement.update({
      where: { id: vassal },
      data: { population: 5, lastTick: new Date(Date.now() - 10 * 60 * 60 * 1000) },
    });

    const lordBefore = await prisma.settlement.findUniqueOrThrow({ where: { id: lord } });

    // Cerrar el tramo del vasallo (resolveSettlement) abona el tributo al señor.
    const { resolveSettlement } = await import("../../lib/resolveSettlement");
    await resolveSettlement(vassal);

    const lordAfter = await prisma.settlement.findUniqueOrThrow({ where: { id: lord } });
    // Serrería N1 con 2 colonos = 10/h → 100 madera en 10h; 15% = ~15 de tributo.
    expect(lordAfter.tributeReceivedWood).toBeCloseTo(15, 0);
    expect(lordAfter.wood).toBeGreaterThan(lordBefore.wood);
  });
});
