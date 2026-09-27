import { getMarket } from "../lib/db.js";
import type { AgentResult } from "./types.js";

export async function runMarket(city: string | undefined): Promise<AgentResult> {
  const name = (city ?? "").trim();
  if (!name) {
    return {
      agent: "market",
      status: "refused",
      demo: false,
      summary: "Name a city. No market numbers were invented.",
      stated: [],
      missing: ["City"],
      next: "Send a city such as Hialeah.",
    };
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      agent: "market",
      status: "blocked",
      demo: false,
      summary: `No cached market snapshot for ${name}. The market cache is not connected.`,
      stated: [{ label: "City", value: name }],
      missing: ["Median price", "Days on market", "Year over year change", "Source date"],
      next: "Connect Supabase or paste a market export. Do not use a guess.",
    };
  }
  try {
    const market = await getMarket(name);
    if (!market) {
      return {
        agent: "market",
        status: "blocked",
        demo: false,
        summary: `The cache has no row for ${name}.`,
        stated: [{ label: "City", value: name }],
        missing: ["Cached snapshot"],
        next: "Load a snapshot for that city before quoting numbers.",
      };
    }
    return {
      agent: "market",
      status: "ok",
      demo: false,
      summary: `Cached snapshot for ${name}. Check the source date before you quote it.`,
      stated: [{ label: "City", value: name }],
      missing: [],
      next: "Read lastUpdated. If it is old, do not present it as today's market.",
      data: market,
    };
  } catch (error) {
    return {
      agent: "market",
      status: "blocked",
      demo: false,
      summary: error instanceof Error ? error.message : "Market cache failed.",
      stated: [{ label: "City", value: name }],
      missing: ["Cached snapshot"],
      next: "Fix the market cache. No prices were filled in.",
    };
  }
}
