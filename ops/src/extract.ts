import { formatMoney, formatPhone, parseMoneyToken, phoneKey } from './money.ts';

export const FIELD_KEYS = [
  'name',
  'phone',
  'email',
  'lead_source',
  'assigned_agent',
  'property_address',
  'mls_number',
  'showing_requested',
  'showing_available',
  'showing_confirmed',
  'preferred_areas',
  'budget',
  'residence_intent',
  'financing_status',
  'purchase_timeline',
  'motivation',
  'must_haves',
  'deal_breakers',
  'previous_communication',
  'next_action',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];
export type FactStatus = 'known' | 'data_needed' | 'unclear';
export type FactBasis = 'said' | 'confirmed' | 'inferred' | 'missing' | 'stale';
export type ConversationStage = 'new_inquiry' | 'continuing' | 'unclear';

export interface FactField {
  key: FieldKey;
  label: string;
  value: string | null;
  status: FactStatus;
  basis: FactBasis;
  evidence: string | null;
}

export interface Extraction {
  fields: Record<FieldKey, FactField>;
  stage: ConversationStage;
  warnings: string[];
  unclearSpans: string[];
  ocrConfidence: number | null;
}

const LABELS: Record<FieldKey, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  lead_source: 'Lead source',
  assigned_agent: 'Assigned agent',
  property_address: 'Property',
  mls_number: 'MLS number',
  showing_requested: 'Requested showing',
  showing_available: 'Available time',
  showing_confirmed: 'Confirmed showing',
  preferred_areas: 'Preferred areas',
  budget: 'Budget',
  residence_intent: 'Home use',
  financing_status: 'Financing',
  purchase_timeline: 'Purchase timeline',
  motivation: 'Motivation',
  must_haves: 'Must haves',
  deal_breakers: 'Deal breakers',
  previous_communication: 'Previous communication',
  next_action: 'Stated next action',
};

const LABEL_TO_KEY: Record<string, FieldKey> = {
  name: 'name',
  client: 'name',
  buyer: 'name',
  phone: 'phone',
  mobile: 'phone',
  cell: 'phone',
  email: 'email',
  'e-mail': 'email',
  source: 'lead_source',
  'lead source': 'lead_source',
  agent: 'assigned_agent',
  'assigned agent': 'assigned_agent',
  'assigned to': 'assigned_agent',
  property: 'property_address',
  address: 'property_address',
  mls: 'mls_number',
  'mls number': 'mls_number',
  'mls#': 'mls_number',
  budget: 'budget',
  price: 'budget',
  'price range': 'budget',
  areas: 'preferred_areas',
  'preferred areas': 'preferred_areas',
  neighborhoods: 'preferred_areas',
  timeline: 'purchase_timeline',
  'purchase timeline': 'purchase_timeline',
  financing: 'financing_status',
  motivation: 'motivation',
  'must haves': 'must_haves',
  'must-haves': 'must_haves',
  'deal breakers': 'deal_breakers',
  dealbreakers: 'deal_breakers',
  'requested showing': 'showing_requested',
  'showing requested': 'showing_requested',
  'tour request': 'showing_requested',
  available: 'showing_available',
  'client available': 'showing_available',
  'available time': 'showing_available',
  'confirmed showing': 'showing_confirmed',
  'showing confirmed': 'showing_confirmed',
  showing: 'showing_requested',
  'next action': 'next_action',
  'next step': 'next_action',
  'previous communication': 'previous_communication',
  'home use': 'residence_intent',
  intent: 'residence_intent',
  residence: 'residence_intent',
};

const FORM_LABELS = new Set(Object.keys(LABEL_TO_KEY));

export function extractLead(text: string, options?: { unclearSpans?: string[]; ocrConfidence?: number | null }): Extraction {
  const warnings: string[] = [];
  const unclearSpans = [...(options?.unclearSpans ?? [])];
  const labeled = parseLabeled(text);
  const fields = blankFields();
  const stage = detectStage(text);

  setFromLabeled(fields, labeled, unclearSpans, warnings);
  fillFromProse(fields, text, warnings);
  applyFinancing(fields, text, warnings);
  applyIntent(fields, text, warnings);
  applyShowingSentences(fields, text, warnings);
  applyIdentityGuards(fields, warnings);

  if (stage === 'continuing') {
    const excerpt = chatExcerpt(text);
    if (excerpt && fields.previous_communication.status !== 'known') {
      setKnown(fields, 'previous_communication', excerpt, 'Conversation lines in the pasted source.');
    }
  }

  for (const key of FIELD_KEYS) {
    if (fields[key].status === 'known' && fields[key].value && overlapsUnclear(fields[key].evidence, fields[key].value, unclearSpans)) {
      fields[key] = { ...fields[key], value: null, status: 'unclear', evidence: 'Flagged as unclear text.' };
      warnings.push(`${LABELS[key]} was flagged as unclear and was not saved as a fact.`);
    }
  }

  if (options?.ocrConfidence !== null && options?.ocrConfidence !== undefined && options.ocrConfidence < 55) {
    warnings.push(`Screenshot confidence is low (${Math.round(options.ocrConfidence)}). Unclear text was not treated as fact.`);
  }

  return {
    fields,
    stage,
    warnings: unique(warnings),
    unclearSpans,
    ocrConfidence: options?.ocrConfidence ?? null,
  };
}

export function lacksIdentity(extraction: Extraction): boolean {
  return (['name', 'phone', 'email'] as const).every((key) => extraction.fields[key].status !== 'known');
}

export function firstNameOf(full: string | null): string | null {
  if (!full) return null;
  const first = full.trim().split(/\s+/)[0] ?? '';
  if (!/^[A-Za-z][A-Za-z']{1,20}$/.test(first)) return null;
  return first;
}

export function propertyLabel(fields: Record<FieldKey, FactField>): string | null {
  const address = fields.property_address.status === 'known' ? fields.property_address.value : null;
  const area = fields.preferred_areas.status === 'known' ? fields.preferred_areas.value : null;
  if (address && looksLikeStreet(address)) {
    const street = address.split(',')[0]?.trim() || address;
    if (area && !street.toLowerCase().includes(area.toLowerCase())) return `${street} in ${area}`;
    return street;
  }
  if (address) {
    const cleaned = address.replace(/\bproperty\b/gi, '').replace(/\s+/g, ' ').trim();
    if (cleaned) return `the ${cleaned} property`;
  }
  if (area) return `the ${area} property`;
  return null;
}

function blankFields(): Record<FieldKey, FactField> {
  const fields = {} as Record<FieldKey, FactField>;
  for (const key of FIELD_KEYS) {
    fields[key] = { key, label: LABELS[key], value: null, status: 'data_needed', basis: 'missing', evidence: null };
  }
  return fields;
}

function parseLabeled(text: string): Map<FieldKey, string[]> {
  const found = new Map<FieldKey, string[]>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const key = LABEL_TO_KEY[label];
    if (!key) continue;
    const value = match[2].trim();
    const list = found.get(key) ?? [];
    list.push(value);
    found.set(key, list);
  }
  return found;
}

function setFromLabeled(
  fields: Record<FieldKey, FactField>,
  labeled: Map<FieldKey, string[]>,
  unclearSpans: string[],
  warnings: string[],
): void {
  for (const [key, values] of labeled) {
    const distinct = unique(values.map((value) => value.trim()).filter(Boolean));
    if (distinct.length === 0) continue;
    if (distinct.some((value) => isUnclearValue(value) || unclearSpans.some((span) => value.includes(span)))) {
      fields[key] = { ...fields[key], value: null, status: 'unclear', evidence: distinct.join(' | ') };
      warnings.push(`${LABELS[key]} includes unclear text and was not saved as a fact.`);
      continue;
    }
    if (key === 'budget') {
      applyBudgetValues(fields, distinct, warnings, distinct.join(' | '));
      continue;
    }
    if (key === 'phone') {
      const formatted = distinct.map((value) => formatPhone(value)).filter((value): value is string => Boolean(value));
      if (formatted.length === 0) {
        fields.phone = { ...fields.phone, value: null, status: 'unclear', evidence: distinct.join(' | ') };
        warnings.push('A phone number was present but could not be read as a 10 digit number.');
        continue;
      }
      if (new Set(formatted).size > 1) {
        fields.phone = { ...fields.phone, value: null, status: 'unclear', evidence: formatted.join(' | ') };
        warnings.push(`Conflicting phone numbers were kept for review: ${formatted.join(' and ')}.`);
        continue;
      }
      setKnown(fields, 'phone', formatted[0], distinct[0]);
      continue;
    }
    if (key === 'showing_confirmed') {
      setKnown(fields, key, distinct[0], 'The source explicitly labeled a confirmed showing.', 'confirmed');
      continue;
    }
    if (distinct.length > 1 && new Set(distinct.map((value) => value.toLowerCase())).size > 1 && key !== 'must_haves' && key !== 'deal_breakers') {
      fields[key] = { ...fields[key], value: null, status: 'unclear', evidence: distinct.join(' | ') };
      warnings.push(`Conflicting ${LABELS[key].toLowerCase()} values were kept for review: ${distinct.join(' and ')}.`);
      continue;
    }
    setKnown(fields, key, distinct.join('; '), `Labeled in the source as ${LABELS[key].toLowerCase()}.`);
  }
}

function fillFromProse(fields: Record<FieldKey, FactField>, text: string, warnings: string[]): void {
  if (fields.email.status !== 'known') {
    const emails = unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((email) => email.toLowerCase());
    if (emails.length === 1) setKnown(fields, 'email', emails[0], 'Email found in the source.');
    if (emails.length > 1) {
      fields.email = { ...fields.email, status: 'unclear', evidence: emails.join(' | ') };
      warnings.push(`Conflicting emails were kept for review: ${emails.join(' and ')}.`);
    }
  }

  if (fields.phone.status !== 'known' && fields.phone.status !== 'unclear') {
    const phones = unique(
      (text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? [])
        .map((value) => formatPhone(value))
        .filter((value): value is string => Boolean(value)),
    );
    if (phones.length === 1) setKnown(fields, 'phone', phones[0], 'Phone found in the source.');
    if (phones.length > 1) {
      fields.phone = { ...fields.phone, status: 'unclear', evidence: phones.join(' | ') };
      warnings.push(`Conflicting phone numbers were kept for review: ${phones.join(' and ')}.`);
    }
  }

  if (fields.lead_source.status !== 'known' && /\bredfin\b/i.test(text)) {
    setKnown(fields, 'lead_source', 'Redfin', 'The source text names Redfin.');
  }

  if (fields.mls_number.status !== 'known') {
    const mls = text.match(/\bMLS\s*#?\s*([A-Z]{0,2}\d{5,})\b/i);
    if (mls) setKnown(fields, 'mls_number', mls[1].toUpperCase(), 'MLS number found in the source.');
  }

  if (fields.budget.status === 'data_needed') {
    const amounts = moneyAmounts(text);
    applyBudgetValues(fields, amounts.map((amount) => formatMoney(amount)), warnings, 'Amounts found in the source.');
  }

  if (fields.purchase_timeline.status === 'data_needed') {
    const timeline = text.match(/\b(asap|immediately|this month|next month|\d{1,3}\s+days|lease ends[^.\n]{0,40})\b/i);
    if (timeline) setKnown(fields, 'purchase_timeline', cleanup(timeline[1]), 'Timing phrase found in the source.');
  }

  if (fields.motivation.status === 'data_needed') {
    const motivation = text.match(/\b(?:because|motivated by)\s+([^.\n]{3,80})/i);
    if (motivation) setKnown(fields, 'motivation', cleanup(motivation[1]), 'Motivation phrase found in the source.');
  }
}

function applyFinancing(fields: Record<FieldKey, FactField>, text: string, warnings: string[]): void {
  if (fields.financing_status.status === 'unclear') return;
  const source = fields.financing_status.status === 'known' && fields.financing_status.value
    ? fields.financing_status.value
    : text;
  const normalized = normalizeFinancing(source) ?? (source !== text ? normalizeFinancing(text) : null);
  if (normalized) {
    setKnown(fields, 'financing_status', normalized, 'Financing words found in the source. This is not lender verification.');
    return;
  }
  if (fields.financing_status.status === 'known') {
    fields.financing_status = {
      ...fields.financing_status,
      value: null,
      status: 'data_needed',
      basis: 'missing',
      evidence: fields.financing_status.value,
    };
  }
  if (/\b(financing|mortgage|loan)\b/i.test(text)) {
    warnings.push('Financing was mentioned without a pre-approval, approval, or cash statement. Approval was not inferred.');
  }
}

function normalizeFinancing(text: string): string | null {
  if (/\bnot\s+pre[-\s]?approved\b/i.test(text)) return 'Not pre-approved (stated)';
  if (/\bpre[-\s]?approved\b/i.test(text)) return 'Pre-approved (stated, not verified)';
  if (/\b(fully approved|approval letter)\b/i.test(text)) return 'Approval stated in the source. Verify the letter before relying on it.';
  if (/\bpre[-\s]?qualified\b/i.test(text)) return 'Pre-qualified (stated, not verified)';
  if (/\b(cash buyer|paying cash|all cash|cash purchase)\b/i.test(text)) return 'Cash (stated, not verified)';
  if (/\b(need|needs|needed)\s+(a\s+)?lender\b/i.test(text)) return 'Needs a lender (stated)';
  return null;
}

function applyIntent(fields: Record<FieldKey, FactField>, text: string, warnings: string[]): void {
  if (fields.residence_intent.status === 'known' || fields.residence_intent.status === 'unclear') {
    if (fields.residence_intent.value) {
      const normalized = normalizeIntent(fields.residence_intent.value);
      if (normalized.length === 1) fields.residence_intent = { ...fields.residence_intent, value: normalized[0] };
      if (normalized.length > 1) {
        fields.residence_intent = { ...fields.residence_intent, value: null, status: 'unclear' };
        warnings.push(`Conflicting home use values were kept for review: ${normalized.join(' and ')}.`);
      }
    }
    return;
  }
  const found = normalizeIntent(text);
  if (found.length === 1) setKnown(fields, 'residence_intent', found[0], 'Home use words found in the source.');
  if (found.length > 1) {
    fields.residence_intent = { ...fields.residence_intent, status: 'unclear', evidence: found.join(' | ') };
    warnings.push(`Conflicting home use values were kept for review: ${found.join(' and ')}.`);
  }
}

function normalizeIntent(text: string): string[] {
  const found: string[] = [];
  if (/\b(primary residence|primary home|owner[- ]occupied)\b/i.test(text)) found.push('Primary residence');
  if (/\b(second home|vacation home)\b/i.test(text)) found.push('Second home');
  if (/\b(investment property|as an investment|rental property|investment)\b/i.test(text)) found.push('Investment');
  return unique(found);
}

function applyShowingSentences(fields: Record<FieldKey, FactField>, text: string, warnings: string[]): void {
  const sentences = text
    .split(/\n|(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    if (isFormLine(sentence)) continue;
    const time = extractTimePhrase(sentence);
    if (!time) continue;
    if (isExplicitConfirmation(sentence)) {
      if (fields.showing_confirmed.status !== 'known') {
        setKnown(fields, 'showing_confirmed', time, sentence, 'confirmed');
      }
      continue;
    }
    if (isAvailability(sentence) && fields.showing_available.status !== 'known') {
      setKnown(fields, 'showing_available', time, sentence);
      continue;
    }
    if (isRequested(sentence) && fields.showing_requested.status !== 'known') {
      setKnown(fields, 'showing_requested', time, sentence);
    }
  }
}

function applyIdentityGuards(fields: Record<FieldKey, FactField>, warnings: string[]): void {
  const agent = fields.assigned_agent.value?.toLowerCase() ?? '';
  const name = fields.name.value?.trim() ?? '';
  if (name && (name.toLowerCase() === 'kyle kleinman' || (agent && name.toLowerCase() === agent))) {
    fields.name = { ...fields.name, value: null, status: 'data_needed', basis: 'missing', evidence: 'The only name matched the assigned agent.' };
    warnings.push('The client name matched the agent, so it was not saved as the client.');
  }
  if (name && /^(redfin|unknown|n\/a|test)$/i.test(name)) {
    fields.name = { ...fields.name, value: null, status: 'data_needed', basis: 'missing' };
  }
}

function detectStage(text: string): ConversationStage {
  const chatLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const match = line.match(/^([^:]{2,40}):\s+\S+/);
      if (!match) return false;
      return !FORM_LABELS.has(match[1].trim().toLowerCase());
    });
  if (chatLines.length >= 2) return 'continuing';
  if (/\b(as we discussed|you asked|following up|per our last)\b/i.test(text)) return 'continuing';
  if (/\b(new (lead|inquiry)|tour request|showing request|request for)\b/i.test(text)) return 'new_inquiry';
  return 'new_inquiry';
}

function chatExcerpt(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const match = line.match(/^([^:]{2,40}):\s+\S+/);
      if (!match) return false;
      return !FORM_LABELS.has(match[1].trim().toLowerCase());
    });
  if (lines.length < 2) return null;
  return lines.slice(0, 6).join(' ').slice(0, 280);
}

function applyBudgetValues(fields: Record<FieldKey, FactField>, tokens: string[], warnings: string[], evidence: string): void {
  const amounts: number[] = [];
  for (const token of tokens) {
    const pieces = token.match(/\$?\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?/g) ?? [];
    for (const piece of pieces) {
      const amount = parseMoneyToken(piece.replace(/\s/g, ''));
      if (amount !== null && amount >= 50_000) amounts.push(amount);
    }
  }
  const distinctAmounts = [...new Set(amounts)];
  if (distinctAmounts.length === 1) {
    setKnown(fields, 'budget', formatMoney(distinctAmounts[0]), evidence);
    return;
  }
  if (distinctAmounts.length > 1) {
    fields.budget = {
      ...fields.budget,
      value: null,
      status: 'unclear',
      evidence: distinctAmounts.map((amount) => formatMoney(amount)).join(' | '),
    };
    warnings.push(`Conflicting budget figures were kept for review: ${distinctAmounts.map((amount) => formatMoney(amount)).join(' and ')}.`);
  }
}

function moneyAmounts(text: string): number[] {
  const tokens = text.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?|\b\d[\d,]*(?:\.\d+)?\s?[kKmM]\b/g) ?? [];
  return tokens
    .map((token) => parseMoneyToken(token.replace(/\s/g, '')))
    .filter((amount): amount is number => amount !== null && amount >= 50_000);
}

function isExplicitConfirmation(sentence: string): boolean {
  if (/\b(not|never|un)[-\s]?confirmed\b/i.test(sentence)) return false;
  if (/\bif\b[^.]{0,60}\bconfirmed\b/i.test(sentence)) return false;
  if (/\b(get it confirmed|once confirmed|when confirmed|to confirm)\b/i.test(sentence)) return false;
  return /\b(showing|appointment|tour)\s+(is\s+)?confirmed\b/i.test(sentence)
    || /\bconfirmed\s+(for|at)\b/i.test(sentence)
    || /\b(you're|you are)\s+confirmed\b/i.test(sentence)
    || /\b(appointment|showing)\s+is\s+set\b/i.test(sentence);
}

function isAvailability(sentence: string): boolean {
  return /\b(i can do|i'm available|i am available|available at|free at|works for me)\b/i.test(sentence);
}

function isRequested(sentence: string): boolean {
  return /\b(request(?:ed)?|would like|want(?:s)? to (?:see|tour)|showing at|tour at|see it at|does\b[^.]{0,40}\bwork)\b/i.test(sentence);
}

function extractTimePhrase(sentence: string): string | null {
  const match = sentence.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s+today|\s+tomorrow)?|noon|this morning|this afternoon|this evening|tomorrow morning|tomorrow afternoon)\b/i);
  return match ? cleanup(match[1]) : null;
}

function isFormLine(sentence: string): boolean {
  const match = sentence.match(/^([^:]{2,40}):\s+/);
  if (!match) return false;
  return FORM_LABELS.has(match[1].trim().toLowerCase());
}

function looksLikeStreet(value: string): boolean {
  return /\d/.test(value) && /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ct|court|ln|lane|way|pl|place|ter|terrace)\b/i.test(value);
}

function isUnclearValue(value: string): boolean {
  return /[�]|\?{2,}|\[(illegible|unclear|unreadable)\]/i.test(value);
}

function overlapsUnclear(evidence: string | null, value: string | null, spans: string[]): boolean {
  if (spans.length === 0) return false;
  const haystack = `${evidence ?? ''} ${value ?? ''}`;
  return spans.some((span) => span.trim().length > 1 && haystack.includes(span));
}

function setKnown(fields: Record<FieldKey, FactField>, key: FieldKey, value: string, evidence: string, basis: FactBasis = 'said'): void {
  fields[key] = { ...fields[key], value: cleanup(value), status: 'known', basis, evidence };
}

function cleanup(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    result.push(key);
  }
  return result;
}

export function phoneLookupKey(value: string | null): string | null {
  if (!value) return null;
  return phoneKey(value);
}
