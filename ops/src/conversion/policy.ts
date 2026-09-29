export const PRIMARY_STAGES = [
  'NEW_INQUIRY',
  'CONTACT_ATTEMPTED',
  'ENGAGED',
  'QUALIFYING',
  'CONSULT_READY',
  'SEARCH_ACTIVE',
  'TOURING',
  'OFFER_READY',
  'OFFER_SUBMITTED',
  'UNDER_CONTRACT',
  'CLOSED',
  'PAST_CLIENT',
  'NURTURE',
  'LOST',
  'DO_NOT_CONTACT',
] as const;

export type PrimaryStage = (typeof PRIMARY_STAGES)[number];

export const READINESS_FLAGS = [
  'contact',
  'motivation',
  'timeline',
  'financing',
  'representation',
  'search',
  'tour',
  'offer',
  'home_sale',
  'decision_maker',
] as const;

export type ReadinessFlag = (typeof READINESS_FLAGS)[number];

export const FINANCING_STATES = [
  'UNKNOWN',
  'CASH',
  'INTRODUCED',
  'APPLICATION_SENT',
  'APPLICATION_STARTED',
  'DOCUMENTS_PENDING',
  'PREQUALIFIED',
  'PREAPPROVED',
  'FINANCING_READY',
] as const;

export type FinancingState = (typeof FINANCING_STATES)[number];

export const CLASSIFICATION_AXES = [
  'occupancy',
  'experience',
  'financing_type',
  'property_strategy',
  'dependency',
] as const;

export type ClassificationAxis = (typeof CLASSIFICATION_AXES)[number];

export const DEPENDENCY_VALUES = [
  'renter',
  'homeowner_no_sale',
  'sale_required',
  'proceeds_required',
] as const;

export type Confirmation = 'customer_confirmed' | 'kyle_confirmed';

export const INTAKE_FIELDS = [
  'motivation',
  'area',
  'timeframe',
  'occupancy',
  'cash_vs_finance',
  'preapproval',
  'current_home',
  'sale_dependency',
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

export const QUESTIONS: Record<IntakeField, string> = {
  motivation: 'What is prompting the move?',
  area: 'Which areas do you want to focus on?',
  timeframe: 'What timeframe are you hoping to buy in?',
  occupancy: 'Will this be a primary home, a second home, or an investment?',
  cash_vs_finance: 'Are you planning to pay cash, or will you finance the purchase?',
  preapproval: 'Have you been preapproved, or do you still need a lender?',
  current_home: 'Do you rent now, or do you own a home?',
  sale_dependency: 'Do you need to sell a current home before you buy?',
};

export const BANNED_PHRASES = [
  'just checking in',
  'touching base',
  'circling back',
  "i'm paid on your satisfaction",
  'i’m paid on your satisfaction',
];

const SENSITIVE_DOCS = /\b(ssn|social security|tax returns?|w-2|w2|bank statements?|pay stubs?|account numbers?)\b/i;

/** Introduced to a lender with no application after this lag gets a follow-up. */
export const LENDER_APPLICATION_LAG_MS = 3 * 24 * 60 * 60 * 1000;

export const TIMELINE_LEAD_DAYS = {
  preapproval: 100,
  consult: 90,
  search: 75,
  touring: 45,
  offerWindowStart: 30,
  offerWindowEnd: 14,
} as const;

export const CONSULT_TRIGGERS = [
  'financing_ready',
  'tour_request',
  'home_to_sell',
  'relocation',
  'investor',
  'high_engagement',
] as const;

export type ConsultTrigger = (typeof CONSULT_TRIGGERS)[number];

export const PRIORITY_BUCKETS = ['ACT_NOW', 'TODAY', 'THIS_WEEK', 'NURTURE', 'DO_NOT_CONTACT'] as const;

export type PriorityBucket = (typeof PRIORITY_BUCKETS)[number];

export interface NextQuestion {
  field: IntakeField;
  question: string;
}

export interface NextBestAction {
  action_type: string;
  client_id: string;
  opportunity_id: string;
  reason: string;
  evidence: string[];
  urgency: PriorityBucket;
  confidence: 'low' | 'medium' | 'high';
  execution_method: 'draft' | 'kyle_handoff' | 'none';
  approval_required: boolean;
  deadline: string | null;
  expected_outcome: string;
  failure_action: string;
  follow_up_trigger: string | null;
  priority_score: number;
  priority_bucket: PriorityBucket;
  priority_reasons: string[];
  live: false;
}

export function screenOutreach(body: string, channel: 'sms' | 'email' | 'voice' | 'internal'): { allowed: boolean; reason: string } {
  const lowered = body.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lowered.includes(phrase)) {
      return { allowed: false, reason: `Banned phrase: ${phrase}` };
    }
  }
  if (channel === 'sms' && SENSITIVE_DOCS.test(body)) {
    return { allowed: false, reason: 'Sensitive borrower documents are not requested by SMS.' };
  }
  return { allowed: true, reason: 'Draft is allowed. Nothing was sent.' };
}

export function detectHandoff(text: string): { needed: boolean; reason: string; level: number } {
  const body = text.trim();
  if (/\b(make an offer|want to offer|write an offer|submit an offer|offer on)\b/i.test(body) || /\b(negotiat|contract)\b/i.test(body)) {
    return { needed: true, reason: 'Offer, negotiation, or contract language. Level 4 stays with Kyle.', level: 4 };
  }
  if (/\b(attorney|lawsuit|legal question|contract clause)\b/i.test(body)) {
    return { needed: true, reason: 'Legal question. Kyle has to take it.', level: 4 };
  }
  if (/\b(commission|buyer broker|representation agreement|who pays you)\b/i.test(body)) {
    return { needed: true, reason: 'Commission or representation question. Kyle has to take it.', level: 4 };
  }
  if (/\b(denied|credit problem|financing fell through|can't get approved|cannot get approved)\b/i.test(body)) {
    return { needed: true, reason: 'Financing problem. Kyle has to take it.', level: 3 };
  }
  if (/\b(frustrated|this is ridiculous|angry|waste of time)\b/i.test(body)) {
    return { needed: true, reason: 'Frustration. Kyle has to take it.', level: 3 };
  }
  if (/\b(talk to kyle|speak with kyle|speak to kyle|is kyle there|call me kyle|want kyle)\b/i.test(body)) {
    return { needed: true, reason: 'The customer asked for Kyle.', level: 3 };
  }
  return { needed: false, reason: '', level: 0 };
}
