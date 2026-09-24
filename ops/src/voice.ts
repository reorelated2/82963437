import { FIELD_KEYS, firstNameOf, propertyLabel, type Extraction, type FactField, type FieldKey } from './extract.ts';
import { formatEt, suggestDueAt } from './time.ts';

export interface ClientDraft {
  body: string;
  purpose: string;
  question: string;
  channel: 'text' | 'email';
}

export interface FollowUpPlan {
  action: string;
  dueAt: string;
  display: string;
  reason: string;
}

export function draftClientMessage(extraction: Extraction): ClientDraft {
  const name = known(extraction, 'name');
  const first = firstNameOf(name);
  const label = propertyLabel(extraction.fields);
  const requested = known(extraction, 'showing_requested');
  const available = known(extraction, 'showing_available');
  const confirmed = known(extraction, 'showing_confirmed');
  const choice = chooseQuestion(extraction, label, requested, available, confirmed);
  const continuing = extraction.stage === 'continuing';
  let body: string;
  if (continuing) {
    body = choice.question;
  } else if (first && label) {
    body = `Hey ${first}, Kyle Kleinman with Redfin. I saw your request for ${label}. ${choice.question}`;
  } else if (first) {
    body = `Hey ${first}, Kyle Kleinman with Redfin. I got your inquiry. ${choice.question}`;
  } else if (label) {
    body = `Kyle Kleinman with Redfin here. I saw your request for ${label}. ${choice.question}`;
  } else {
    body = `Kyle Kleinman with Redfin here. I got your inquiry. ${choice.question}`;
  }
  return {
    body: sanitizeClientCopy(body),
    purpose: choice.purpose,
    question: sanitizeClientCopy(choice.question),
    channel: known(extraction, 'phone') ? 'text' : known(extraction, 'email') ? 'email' : 'text',
  };
}

export function buyerSummary(extraction: Extraction): string {
  const name = known(extraction, 'name') ?? 'This lead';
  const parts: string[] = [];
  const label = propertyLabel(extraction.fields);
  if (label) parts.push(`${name} asked about ${label}.`);
  else parts.push(`${name} came in without a property named in the source.`);
  const requested = known(extraction, 'showing_requested');
  const available = known(extraction, 'showing_available');
  const confirmed = known(extraction, 'showing_confirmed');
  if (requested) parts.push(`Requested showing time is ${requested}. That time is not confirmed.`);
  if (available) parts.push(`The source says they can do ${available}. That is availability, not a booked showing.`);
  if (confirmed) parts.push(`The source explicitly says the showing is confirmed for ${confirmed}.`);
  const budget = known(extraction, 'budget');
  if (budget) parts.push(`Budget stated at ${budget}.`);
  const intent = known(extraction, 'residence_intent');
  if (intent) parts.push(`Home use stated as ${intent.toLowerCase()}.`);
  const financing = known(extraction, 'financing_status');
  if (financing) parts.push(`Financing note: ${financing}.`);
  const timeline = known(extraction, 'purchase_timeline');
  if (timeline) parts.push(`Timeline stated as ${timeline}.`);
  const motivation = known(extraction, 'motivation');
  if (motivation) parts.push(`Motivation stated as ${motivation}.`);
  const needed = missingLabels(extraction);
  const summary = sanitizeClientCopy(parts.join(' '));
  if (needed.length === 0) return summary;
  return `${summary} Still needed: ${needed.join(', ')}.`;
}

export function internalNote(extraction: Extraction, draft: ClientDraft): string {
  const name = known(extraction, 'name') ?? 'Unnamed lead';
  const requested = known(extraction, 'showing_requested');
  const showing = requested ? `${requested} is requested, not confirmed.` : 'No showing time is confirmed.';
  return `${name}. ${showing} Draft is waiting and was not sent. Purpose: ${draft.purpose}`;
}

export function crmNote(extraction: Extraction, followUp: FollowUpPlan, draft: ClientDraft, contactId: string | null): string {
  const lines: string[] = [
    'CRM note for Redfin Partner Tools',
    'This desk does not update Redfin. Paste the note there if you want it on the official record.',
    `Local record: ${contactId ?? 'not created yet'}`,
    '',
    'Known facts',
  ];
  for (const key of FIELD_KEYS) {
    const field = extraction.fields[key];
    if (field.status === 'known' && field.value) lines.push(`${field.label}: ${field.value}`);
  }
  lines.push('', 'Data needed');
  const needed = FIELD_KEYS.filter((key) => extraction.fields[key].status === 'data_needed');
  if (needed.length === 0) lines.push('None');
  for (const key of needed) lines.push(`${extraction.fields[key].label}: Data needed`);
  const unclear = FIELD_KEYS.filter((key) => extraction.fields[key].status === 'unclear');
  lines.push('', 'Unclear or conflicting');
  if (unclear.length === 0 && extraction.warnings.length === 0) lines.push('None');
  for (const key of unclear) {
    lines.push(`${extraction.fields[key].label}: unclear. Evidence kept: ${extraction.fields[key].evidence ?? 'none'}`);
  }
  for (const warning of extraction.warnings) lines.push(warning);
  lines.push(
    '',
    'Suggested next action',
    followUp.action,
    '',
    'Suggested follow up',
    `${followUp.display}. ${followUp.reason}`,
    '',
    'Draft prepared, not sent',
    draft.body,
  );
  return lines.join('\n');
}

export function planFollowUp(extraction: Extraction, now: Date): FollowUpPlan {
  const requested = known(extraction, 'showing_requested');
  const confirmed = known(extraction, 'showing_confirmed');
  const urgent = Boolean(requested) && !confirmed;
  const due = suggestDueAt(now, requested, urgent);
  let action = 'Review the draft and send it yourself only if it still matches this client.';
  let reason = 'New lead facts are in the review queue.';
  if (urgent) {
    action = 'Check whether the requested showing time can be booked. Do not tell the client it is confirmed.';
    reason = 'A showing was requested and is not confirmed.';
  } else if (!known(extraction, 'budget')) {
    action = 'Ask for the price range before sending homes.';
    reason = 'Budget is still data needed.';
  } else if (!known(extraction, 'financing_status')) {
    action = 'Ask whether they are paying cash or already have a pre approval. Do not assume approval.';
    reason = 'Financing status is still data needed.';
  }
  return {
    action,
    dueAt: due.toISOString(),
    display: formatEt(due),
    reason,
  };
}

function chooseQuestion(
  extraction: Extraction,
  label: string | null,
  requested: string | null,
  available: string | null,
  confirmed: string | null,
): { question: string; purpose: string } {
  if (requested && !confirmed) {
    return {
      purpose: 'Ask whether the requested time can be pursued. Do not treat it as booked.',
      question: `Does ${requested} work for you if I can get it confirmed?`,
    };
  }
  if (available && !confirmed) {
    return {
      purpose: 'Ask permission to request the time they said they can do.',
      question: `You mentioned ${available}. Should I request that showing time?`,
    };
  }
  if (!label) {
    return {
      purpose: 'Find which property they want before asking anything else.',
      question: 'Which property should I start with?',
    };
  }
  if (!requested && !available && !confirmed) {
    return {
      purpose: 'Get a usable showing time.',
      question: 'What time works for you to see it?',
    };
  }
  if (!known(extraction, 'budget')) {
    return {
      purpose: 'Get a budget before sending homes.',
      question: 'What price range should I stay inside?',
    };
  }
  if (!known(extraction, 'financing_status')) {
    return {
      purpose: 'Ask financing without assuming approval.',
      question: 'Are you paying cash, or do you already have a pre approval letter?',
    };
  }
  if (!known(extraction, 'preferred_areas')) {
    return {
      purpose: 'Get the search area.',
      question: 'Which neighborhoods should I focus on?',
    };
  }
  if (!known(extraction, 'purchase_timeline')) {
    return {
      purpose: 'Get timing.',
      question: 'When do you want to be under contract?',
    };
  }
  return {
    purpose: 'Offer the next concrete step from what they already said.',
    question: 'Want me to send a short list that fits what you told me?',
  };
}

export function sanitizeClientCopy(text: string): string {
  let out = text.replace(/[—–]/g, ', ');
  out = out.replace(/\s+-\s+/g, ', ');
  out = out.replace(/-/g, ' ');
  out = out.replace(/!/g, '.');
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\s+([?.])/g, '$1');
  out = out.replace(/([?.])\1+/g, '$1');
  return out.trim();
}

export function missingLabels(extraction: Extraction): string[] {
  return FIELD_KEYS.filter((key) => extraction.fields[key].status !== 'known').map((key) => extraction.fields[key].label);
}

function known(extraction: Extraction, key: FieldKey): string | null {
  const field: FactField = extraction.fields[key];
  return field.status === 'known' ? field.value : null;
}
