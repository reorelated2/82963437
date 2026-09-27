import { runConsult } from "./consult.js";
import { runMarket } from "./market.js";
import { runMls } from "./mls.js";
import { AGENTS, type AgentResult } from "./types.js";

export interface AgentRequest {
  answers?: Record<string, unknown>;
  city?: string;
  feeds?: unknown;
  config?: { targetZip?: string; maxBudget?: number };
  demoSeed?: boolean;
  intent?: string;
}

const INQUIRY = /\b(send|text|sms|email|screenshot|inquiry|follow up|follow-up|note to redfin|crm note)\b/i;

export function listAgents(): typeof AGENTS {
  return AGENTS;
}

export async function runAgent(name: string, body: AgentRequest): Promise<AgentResult> {
  if (INQUIRY.test(body.intent ?? "") || INQUIRY.test(name)) {
    return refused();
  }
  if (name === "consult") return runConsult(body.answers);
  if (name === "market") return runMarket(body.city);
  if (name === "mls") return runMls({ feeds: body.feeds as never, config: body.config, demoSeed: body.demoSeed });
  if (name === "desk") return route(body);
  return {
    agent: name,
    status: "refused",
    demo: false,
    summary: `No agent named ${name}.`,
    stated: [],
    missing: [],
    next: "Use consult, market, or mls.",
  };
}

async function route(body: AgentRequest): Promise<AgentResult> {
  const intent = body.intent ?? "";
  if (INQUIRY.test(intent)) return refused();
  if (/\b(mls|listing|duplex|hiram|zip|comp)\b/i.test(intent) || body.feeds || body.demoSeed) {
    const result = runMls({ feeds: body.feeds as never, config: body.config, demoSeed: body.demoSeed });
    return { ...result, data: { routedTo: "mls", payload: result.data } };
  }
  if (/\b(market|median|inventory|days on market)\b/i.test(intent) || (body.city && !body.answers)) {
    const result = await runMarket(body.city);
    return { ...result, data: { routedTo: "market", payload: result.data } };
  }
  if (body.answers || /\b(consult|buyer|readiness|financing|intake)\b/i.test(intent)) {
    const result = runConsult(body.answers);
    return { ...result, agent: "consult", data: { routedTo: "consult", payload: result.data } };
  }
  return {
    agent: "desk",
    status: "refused",
    demo: false,
    summary: "Say whether this is a consult, a market snapshot, or an MLS ranking.",
    stated: [],
    missing: ["Which agent"],
    next: "consult, market, or mls. Inquiry drafts stay with the other agent.",
  };
}

function refused(): AgentResult {
  return {
    agent: "desk",
    status: "refused",
    demo: false,
    summary: "This server does not draft or send client messages. That board belongs to the other agent.",
    stated: [],
    missing: [],
    next: "Use the inquiry agent for SEND, NOTE, and NEXT.",
  };
}
