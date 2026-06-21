import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmail } from "./admin";

const original = process.env.ADMIN_EMAILS;
afterEach(() => {
  process.env.ADMIN_EMAILS = original;
});

describe("isAdminEmail", () => {
  it("reconoce emails de la lista blanca (sin distinguir mayúsculas)", () => {
    process.env.ADMIN_EMAILS = "jefe@x.com, otra@y.com";
    expect(isAdminEmail("jefe@x.com")).toBe(true);
    expect(isAdminEmail("JEFE@X.COM")).toBe(true);
    expect(isAdminEmail("otra@y.com")).toBe(true);
  });

  it("rechaza emails fuera de la lista, vacíos o nulos", () => {
    process.env.ADMIN_EMAILS = "jefe@x.com";
    expect(isAdminEmail("random@x.com")).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("sin ADMIN_EMAILS, nadie es admin", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail("jefe@x.com")).toBe(false);
  });
});
