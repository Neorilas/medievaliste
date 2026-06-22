import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizeUsername,
  isValidEmail,
  validateUsername,
  validatePassword,
  looksLikeEmail,
} from "./accountValidation";

describe("normalizeEmail", () => {
  it("pasa a minúsculas y recorta", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
});

describe("normalizeUsername", () => {
  it("pasa a minúsculas y recorta los bordes", () => {
    expect(normalizeUsername("  César_99 ")).toBe("césar_99");
  });
});

describe("isValidEmail", () => {
  it("acepta emails con forma válida", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
  });
  it("rechaza emails sin arroba o sin dominio", () => {
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });
});

describe("validateUsername", () => {
  it("acepta nombres válidos", () => {
    expect(validateUsername("colono")).toBeNull();
    expect(validateUsername("a_b-9")).toBeNull();
  });
  it("rechaza por longitud", () => {
    expect(validateUsername("ab")).toMatch(/entre/);
    expect(validateUsername("a".repeat(21))).toMatch(/entre/);
  });
  it("rechaza caracteres no permitidos", () => {
    expect(validateUsername("con espacio")).toMatch(/solo admite/);
    expect(validateUsername("email@x")).toMatch(/solo admite/);
    expect(validateUsername("acentúado")).toMatch(/solo admite/);
  });
});

describe("validatePassword", () => {
  it("acepta 8+ caracteres", () => {
    expect(validatePassword("12345678")).toBeNull();
  });
  it("rechaza menos de 8", () => {
    expect(validatePassword("1234567")).toMatch(/al menos/);
  });
});

describe("looksLikeEmail", () => {
  it("distingue email de username", () => {
    expect(looksLikeEmail("a@b.com")).toBe(true);
    expect(looksLikeEmail("colono99")).toBe(false);
  });
});
