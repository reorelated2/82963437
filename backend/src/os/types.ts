export type FieldStatus = "stated" | "data_needed" | "unclear" | "conflict";

export type PropertyUse = "primary" | "second" | "investment";

export type ConversationStage = "new" | "continuing";

export interface ExtractedLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  leadSource: string | null;
  assignedAgent: string | null;
  address: string | null;
  mls: string | null;
  requestedShowing: string | null;
  availableShowing: string | null;
  confirmedShowing: string | null;
  areas: string | null;
  budgetLabel: string | null;
  budgetCents: number | null;
  propertyUse: PropertyUse | null;
  financing: string | null;
  financingMentionedWithoutApproval: boolean;
  timeline: string | null;
  motivation: string | null;
  mustHaves: string | null;
  dealBreakers: string | null;
  previousCommunication: string | null;
  nextAction: string | null;
  conversation: ConversationStage;
  fieldStatus: Record<string, FieldStatus>;
  unclearNotes: string[];
  inlineConflicts: { field: string; values: string[] }[];
  lowConfidence: boolean;
}

export interface IntakeResult {
  duplicateEvent: boolean;
  contactId: string;
  reviewId: string;
  createdContact: boolean;
  possibleDuplicateOf: { id: string; name: string } | null;
  conflicts: { field: string; existing: string; incoming: string }[];
  unclear: boolean;
  failure: string | null;
  summary: string;
  internalNote: string;
  buyerSummary: { known: { label: string; value: string }[]; needed: string[] };
  draft: {
    id: string;
    body: string;
    channel: string;
    recipient: string;
    scheduledFor: string | null;
    purpose: string;
    context: string;
  } | null;
  note: { id: string; body: string } | null;
  followUp: { id: string; title: string; dueAt: string; detail: string } | null;
  showing: { requested: string | null; available: string | null; confirmed: string | null };
}

export interface AttentionItem {
  contactId: string | null;
  title: string;
  reason: string;
  action: string;
  href: string;
  demo: boolean;
  tone: "new" | "reply" | "today" | "overdue" | "milestone" | "draft" | "failed";
}

export interface Workspace {
  generatedAt: string;
  outboundPaused: boolean;
  demoOnDesk: boolean;
  spendingLimitUsd: number;
  spendMonthUsd: number;
  hero: { title: string; why: string; action: string; href: string } | null;
  sections: { id: string; title: string; empty: string; items: AttentionItem[] }[];
  alerts: { level: "bad" | "warn"; title: string; detail: string }[];
}

export interface Settings {
  outboundPaused: boolean;
  spendingLimitUsd: number;
  spendMonthUsd: number;
}

export interface IntegrationRow {
  name: string;
  status: "verified_working" | "available_not_connected" | "requires_authorization" | "unsupported_or_unknown";
  purpose: string;
  detail: string;
  checkedOn: string;
  source?: string;
}
