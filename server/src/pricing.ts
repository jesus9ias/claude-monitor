import { readFileSync } from "node:fs";
import type { Usage } from "@claude-monitor/shared";

interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  cacheCreate1h?: number;
}

export interface ModelPrice extends Rates {
  fastMultiplier?: number;
  longPrompt?: Rates & { overTokens: number };
}

export type PriceTable = Record<string, ModelPrice>;

export function loadPricing(): PriceTable {
  return JSON.parse(readFileSync(new URL("./pricing.json", import.meta.url), "utf8")) as PriceTable;
}

/** Exact id first, then the id without a dated suffix (claude-x-1-20250101). */
export function findPrice(table: PriceTable, model: string): ModelPrice | undefined {
  return table[model] ?? table[model.replace(/-\d{8}$/, "")];
}

/** USD for one API message. null when the model has no price. Prices are per 1M tokens. */
export function messageCost(table: PriceTable, model: string, usage: Usage, speed?: string): number | null {
  const price = findPrice(table, model);
  if (!price) return null;

  const promptTokens = usage.input + usage.cacheRead + usage.cacheCreate;
  const rates = price.longPrompt && promptTokens > price.longPrompt.overTokens ? price.longPrompt : price;
  const multiplier = speed === "fast" ? (price.fastMultiplier ?? 1) : 1;
  const rate1h = rates.cacheCreate1h ?? rates.cacheCreate;
  const cacheCreate5m = Math.max(0, usage.cacheCreate - usage.cacheCreate1h);

  const total =
    usage.input * rates.input +
    usage.output * rates.output +
    usage.cacheRead * rates.cacheRead +
    cacheCreate5m * rates.cacheCreate +
    usage.cacheCreate1h * rate1h;
  return (total * multiplier) / 1_000_000;
}
