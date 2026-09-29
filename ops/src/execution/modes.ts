import type { DeskFact } from './plan.ts';

export interface OfferSurface {
  readiness: 'READY' | 'MISSING';
  nextAction: string;
}

export interface TransactionMilestone {
  name: string;
  status: string;
  owner: string;
  deadline: string;
  source: string;
  nextAction: string;
}

const MILESTONES = [
  'OFFER ACCEPTED',
  'CONTRACT EXECUTED',
  'EFFECTIVE DATE VERIFIED',
  'DEPOSIT DUE',
  'DEPOSIT CONFIRMED',
  'INSPECTION ORDERED',
  'INSPECTION COMPLETED',
  'INSPECTION RESPONSE NEEDED',
  'TITLE OPENED',
  'LENDER PROCESSING',
  'INSURANCE NEEDED',
  'APPRAISAL ORDERED',
  'APPRAISAL COMPLETED',
  'APPRAISAL ISSUE',
  'HOA OR CONDO APPLICATION',
  'LOAN CONDITIONS',
  'LOAN APPROVAL',
  'CLEAR TO CLOSE',
  'FINAL WALKTHROUGH',
  'CLOSING',
  'KEYS',
  'CLOSED',
];

const FACT_FOR: Record<string, string> = {
  'OFFER ACCEPTED': 'offer_state',
  'EFFECTIVE DATE VERIFIED': 'effective_date',
  'INSPECTION RESPONSE NEEDED': 'inspection_deadline',
  'INSPECTION ORDERED': 'inspection_status',
  'CLEAR TO CLOSE': 'loan_status',
  'FINAL WALKTHROUGH': 'walkthrough',
  CLOSED: 'transaction_status',
};

function verified(facts: DeskFact[], field: string): string | null {
  return facts.find((fact) => fact.field === field && fact.kind === 'fact' && fact.verification === 'verified')?.value ?? null;
}

export function offerSurface(facts: DeskFact[]): OfferSurface {
  const state = (verified(facts, 'offer_state') ?? '').toLowerCase();
  const request = facts.some((fact) => /offer request|offer first try|wants to offer/i.test(fact.value));
  if (state === 'accepted') {
    return { readiness: 'READY', nextAction: 'Offer accepted is a verified fact. Confirm the executed contract before any deadline.' };
  }
  if (state === 'submitted') {
    return { readiness: 'READY', nextAction: 'Offer submitted only when Kyle or a provider confirmed it. It is not accepted.' };
  }
  if (request || state === 'draft' || verified(facts, 'wants_offer') === 'yes') {
    return {
      readiness: 'MISSING',
      nextAction: 'Offer request only. Not offer ready. Confirm the buyer still wants it and collect missing terms. Do not submit.',
    };
  }
  return { readiness: 'MISSING', nextAction: 'No offer request is on file.' };
}

export function transactionMilestones(facts: DeskFact[]): TransactionMilestone[] {
  return MILESTONES.map((name) => {
    const field = FACT_FOR[name];
    const value = field ? verified(facts, field) : null;
    const matches = value && (
      (name === 'OFFER ACCEPTED' && /accepted/i.test(value))
      || (name === 'CLOSED' && /closed/i.test(value))
      || (name === 'CLEAR TO CLOSE' && /not_clear_to_close|clear/i.test(value))
      || (name !== 'OFFER ACCEPTED' && name !== 'CLOSED' && name !== 'CLEAR TO CLOSE' && value)
    );
    if (!matches || !value) {
      return {
        name,
        status: 'Not on file',
        owner: 'HUMAN REVIEW REQUIRED',
        deadline: 'HUMAN REVIEW REQUIRED',
        source: 'No verified document',
        nextAction: 'Do not compute a deadline.',
      };
    }
    return {
      name,
      status: value,
      owner: 'Kyle',
      deadline: /^\d{4}-\d{2}-\d{2}/.test(value) ? value : 'HUMAN REVIEW REQUIRED',
      source: field ?? 'verified fact',
      nextAction: 'Use the verified fact only. Do not compute the next legal date.',
    };
  });
}

export function transactionLine(facts: DeskFact[]): string {
  const dated = transactionMilestones(facts).filter((item) => item.deadline !== 'HUMAN REVIEW REQUIRED');
  if (dated.length === 0) {
    return 'TRANSACTION MODE: no verified contract deadline on file. HUMAN REVIEW REQUIRED. No deadline was computed.';
  }
  return `TRANSACTION MODE: ${dated.map((item) => `${item.name} ${item.deadline} from ${item.source}`).join('; ')}. Other deadlines are HUMAN REVIEW REQUIRED. None were computed.`;
}
