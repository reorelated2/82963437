import { formatMoney } from "../os/money.js";
import { blank, clean, cleanNumber, nonNegativeNumber } from "./facts.js";

export const NET_TARGET = {
  netUsd: 250_000,
  by: "2027-04-30",
  label: "Planning target. Not a forecast. Net income is Data needed until compensation, expenses, and taxes are supplied.",
} as const;

export interface EvidencePhoto {
  id?: string | null;
  caption?: string | null;
}

export interface EvidenceObservation {
  field?: string | null;
  value?: string | null;
  photoId?: string | null;
}

export interface EvidenceInput {
  address?: string | null;
  collectedAt?: string | null;
  collector?: string | null;
  attestation?: string | null;
  photos?: EvidencePhoto[];
  observations?: EvidenceObservation[];
}

export interface EvidenceResult {
  sent: false;
  sellablePilot: boolean;
  attestation: string;
  attestationStatus: "kept as written" | "missing";
  record: { field: string; value: string; photoId: string | null }[];
  missing: string[];
  conflicts: { field: string; values: string[] }[];
  nextAction: string;
}

export function reviewEvidence(input: EvidenceInput): EvidenceResult {
  const address = clean(input.address);
  const collectedAt = clean(input.collectedAt);
  const collector = clean(input.collector);
  const attestation = clean(input.attestation);
  const photos = (input.photos ?? [])
    .map((photo) => ({ id: clean(photo.id), caption: clean(photo.caption) }))
    .filter((photo): photo is { id: string; caption: string | null } => Boolean(photo.id));
  const observations = (input.observations ?? [])
    .map((item) => ({
      field: clean(item.field),
      value: clean(item.value),
      photoId: clean(item.photoId),
    }))
    .filter((item): item is { field: string; value: string; photoId: string | null } => Boolean(item.field && item.value));

  const grouped = new Map<string, Map<string, string>>();
  for (const item of observations) {
    const key = item.field.toLowerCase();
    const values = grouped.get(key) ?? new Map<string, string>();
    const normalized = item.value.toLowerCase().replace(/\s+/g, " ").trim();
    if (!values.has(normalized)) values.set(normalized, item.value);
    grouped.set(key, values);
  }
  const conflicts = [...grouped.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([field, values]) => ({ field, values: [...values.values()] }));

  const photoIds = new Set(photos.map((photo) => photo.id));
  const record = observations.map((item) => ({
    field: item.field,
    value: item.value,
    photoId: item.photoId && photoIds.has(item.photoId) ? item.photoId : item.photoId,
  }));
  const missing: string[] = [];
  if (!address) missing.push("Address");
  if (!collectedAt) missing.push("Collected at");
  if (!collector) missing.push("Collector");
  if (!attestation) missing.push("Collector attestation");
  if (!photos.length) missing.push("At least one photo");
  if (!observations.length) missing.push("At least one observation");
  const dangling = observations.filter((item) => item.photoId && !photoIds.has(item.photoId));
  if (dangling.length) missing.push("A photo id cited by an observation is not in the photo list");

  const sellablePilot = missing.length === 0 && conflicts.length === 0;
  let nextAction: string;
  if (!attestation) nextAction = "Get the collector's attestation before this record is used or sold.";
  else if (conflicts.length) nextAction = "Resolve the conflicting observations before this record is used.";
  else if (missing.length) nextAction = "Fill the missing evidence before this is a pilot someone could pay for.";
  else nextAction = "The evidence check passed. This is a pilot candidate only. It is not a sale and it was not delivered.";

  return {
    sent: false,
    sellablePilot,
    attestation: attestation ?? "",
    attestationStatus: attestation ? "kept as written" : "missing",
    record: address ? [{ field: "address", value: address, photoId: null }, ...record] : record,
    missing,
    conflicts,
    nextAction,
  };
}

export interface PulseInput {
  topic?: string | null;
  change?: string | null;
  source?: string | null;
  asOf?: string | null;
  implication?: string | null;
  clientsProduced?: number | null;
  dealsProduced?: number | null;
}

export interface PulseResult {
  sent: false;
  publishable: boolean;
  topic: string;
  change: string;
  source: string;
  asOf: string;
  implication: string;
  implicationBasis: "interpretation" | "data needed";
  clientsProduced: string;
  dealsProduced: string;
  nextAction: string;
}

export function reviewInsight(input: PulseInput): PulseResult {
  const topic = clean(input.topic);
  const change = clean(input.change);
  const source = clean(input.source);
  const asOf = clean(input.asOf);
  const implication = clean(input.implication);
  const publishable = Boolean(topic && change && source && asOf);
  const clients = cleanNumber(input.clientsProduced);
  const deals = cleanNumber(input.dealsProduced);
  return {
    sent: false,
    publishable,
    topic: blank(topic),
    change: blank(change),
    source: blank(source),
    asOf: blank(asOf),
    implication: implication ? `Interpretation, not part of the source: ${implication}` : "Data needed",
    implicationBasis: implication ? "interpretation" : "data needed",
    clientsProduced: clients === null || clients < 0 ? "Not measured" : String(clients),
    dealsProduced: deals === null || deals < 0 ? "Not measured" : String(deals),
    nextAction: publishable
      ? "Keep this insight only if you can name the client or deal it produced. Otherwise it is research, not revenue."
      : "Do not publish this. Topic, change, source, and as-of date all have to be filled from the source.",
  };
}

export interface ScoreboardInput {
  agentGeneratedLeads?: number | null;
  lenderIntroductions?: number | null;
  offers?: number | null;
  closings?: number | null;
  volumeUsd?: number | null;
  feedback?: string | null;
  netIncomeUsd?: number | null;
}

export interface ScoreboardResult {
  sent: false;
  target: typeof NET_TARGET;
  agentGeneratedLeads: string;
  lenderIntroductions: string;
  offers: string;
  closings: string;
  volumeUsd: string;
  feedback: string;
  netIncomeUsd: string;
  gapToTarget: string;
  nextAction: string;
}

function countLabel(value: unknown): string {
  const n = cleanNumber(value);
  if (n === null || n < 0 || !Number.isInteger(n)) return "Data needed";
  return String(n);
}

export function scoreboard(input: ScoreboardInput = {}): ScoreboardResult {
  const volume = nonNegativeNumber(input.volumeUsd);
  const net = nonNegativeNumber(input.netIncomeUsd);
  const gap = net === null ? "Data needed" : formatMoney(NET_TARGET.netUsd - net);
  return {
    sent: false,
    target: NET_TARGET,
    agentGeneratedLeads: countLabel(input.agentGeneratedLeads),
    lenderIntroductions: countLabel(input.lenderIntroductions),
    offers: countLabel(input.offers),
    closings: countLabel(input.closings),
    volumeUsd: volume === null ? "Data needed" : formatMoney(volume),
    feedback: clean(input.feedback) ?? "Data needed",
    netIncomeUsd: net === null ? "Data needed" : formatMoney(net),
    gapToTarget: gap === "Data needed" ? "Data needed" : `${gap}. Arithmetic against the planning target, not a forecast.`,
    nextAction:
      net === null
        ? "The $250K figure is a target. Paste the hottest open lead, Capture order, or deal. Do not treat the target as money already coming in."
        : "Net income was supplied. Keep working the item with the best expected value per hour.",
  };
}
