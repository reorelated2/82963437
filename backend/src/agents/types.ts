export type AgentStatus = "ok" | "blocked" | "refused";

export interface AgentResult {
  agent: string;
  status: AgentStatus;
  demo: boolean;
  summary: string;
  stated: { label: string; value: string }[];
  missing: string[];
  next: string;
  data?: unknown;
}

export interface AgentCard {
  name: string;
  job: string;
  input: string;
}

export const AGENTS: AgentCard[] = [
  {
    name: "consult",
    job: "Score a buyer consult from answers you type. Missing financing stays missing.",
    input: "POST /agents/consult with { answers }",
  },
  {
    name: "market",
    job: "Read a cached market snapshot. Returns blocked when the cache is not connected. Does not invent prices.",
    input: "POST /agents/market with { city }",
  },
  {
    name: "mls",
    job: "Rank listings you supply, or return the labeled Hiram demo seed.",
    input: "POST /agents/mls with { feeds } or { demoSeed: true }",
  },
];
