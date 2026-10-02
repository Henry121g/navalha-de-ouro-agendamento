import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("aceita caminhos internos", () => {
    expect(safeNext("/meus-agendamentos")).toBe("/meus-agendamentos");
  });
  it.each(["https://malicioso.test", "//malicioso.test", "/\\malicioso.test", "", null])(
    "recusa %s",
    (v) => {
      expect(safeNext(v)).toBe("/agendar");
    },
  );
});
