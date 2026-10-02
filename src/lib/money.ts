/**
 * Converte texto digitado ("45", "45,5", "1.234,56", "R$ 45,00") em centavos inteiros,
 * sem passar por ponto flutuante. Retorna null se inválido.
 */
export function parseMoneyToCents(input: string): number | null {
  const s = input.replace(/R\$|\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const [intPart, frac = ""] = s.replace(/\./g, "").split(",");
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 10_000_000 ? cents : null;
}

/** Centavos → texto editável ("45,00"). */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}
