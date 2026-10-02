import { describe, expect, it } from "vitest";
import { centsToInput, parseMoneyToCents } from "./money";

describe("parseMoneyToCents", () => {
  it.each([
    ["45", 4500],
    ["45,5", 4550],
    ["45,00", 4500],
    ["0,10", 10],
    ["1.234,56", 123456],
    ["R$ 70,00", 7000],
    ["19,99", 1999], // 19.99 * 100 em float daria 1998.9999...
  ])("%s → %i centavos", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "45,999", "-10", "45.5", "1,2,3"])("recusa %s", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });

  it("ida e volta preserva o valor", () => {
    expect(parseMoneyToCents(centsToInput(1999))).toBe(1999);
    expect(centsToInput(5)).toBe("0,05");
  });
});
