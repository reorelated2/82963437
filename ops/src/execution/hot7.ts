import { ingestCanonicalLead, openCanonicalShell, writeClientFact, type FactInput } from '../canonical.ts';
import { openBuyerFile } from '../conversion/engine.ts';
import type { SqlDb } from '../sql.ts';
import { buildMorningBrief, type MorningBrief } from './brief.ts';
import { recordLeadSource } from './source.ts';

/** Synthetic Hot 7. Phones and emails are fake. Situations follow the spec, not a live export. */
const NOW_DEFAULT = new Date('2026-09-29T13:00:00.000Z');

export function seedHot7(db: SqlDb, now = NOW_DEFAULT): MorningBrief {
  const echo = withContact(db, now, {
    key: 'hot7-echo',
    name: 'Echo Niu',
    phone: '3055552101',
    email: 'echo.fixture@example.com',
    leadSource: 'Redfin',
    facts: [
      fact('property_address', '90 SW 3rd St #308'),
      fact('scheduled_tour_note', '2026-09-27 6:00 PM upcoming tour agent scheduled. Showing agent Larry Dix. Completed tours are 0.'),
      fact('tours_completed', '0'),
      fact('synthetic_fixture', 'hot7'),
    ],
  });
  withContact(db, now, {
    key: 'hot7-erena',
    name: 'Erena Valle',
    phone: '3055552102',
    email: 'erena.fixture@example.com',
    leadSource: 'Redfin',
    facts: [
      fact('property_address', 'Miami listing, address not verified'),
      fact('synthetic_fixture', 'hot7'),
      { fieldKey: 'cash_vs_finance', value: 'cash tag on a household row', kind: 'inference', verification: 'unverified', source: 'synthetic' },
    ],
  });
  withContact(db, now, {
    key: 'hot7-claudia',
    name: 'Claudia Pinheiro',
    phone: '3055552103',
    email: 'claudia.fixture@example.com',
    leadSource: null,
    facts: [
      fact('property_address', 'Tatum Waterway'),
      fact('synthetic_fixture', 'hot7-claudia-not-in-export'),
      { fieldKey: 'associate_tour', value: '2026-09-23 Tatum Waterway with associate agent German. Not verified with Kyle.', kind: 'inference', verification: 'unverified', source: 'synthetic' },
    ],
  });
  withContact(db, now, {
    key: 'hot7-alberto',
    name: 'Alberto Alonso',
    phone: null,
    email: 'alberto.fixture@example.com',
    leadSource: 'Redfin',
    facts: [fact('synthetic_fixture', 'hot7'), fact('property_address', 'Property not verified')],
  });
  shell(db, now, {
    key: 'hot7-mark',
    name: 'Mark Maccagno',
    facts: [
      fact('synthetic_fixture', 'hot7'),
      { fieldKey: 'offer_state', value: 'ready', kind: 'inference', verification: 'unverified', source: 'synthetic' },
      { fieldKey: 'property_address', value: 'street only, no city', kind: 'inference', verification: 'unverified', source: 'synthetic' },
    ],
  });
  shell(db, now, {
    key: 'hot7-perry',
    name: 'Perry Crawford',
    facts: [fact('synthetic_fixture', 'hot7')],
  });
  shell(db, now, {
    key: 'hot7-katherine',
    name: 'Katherine De Armas',
    facts: [
      fact('synthetic_fixture', 'hot7'),
      { fieldKey: 'sale_dependency', value: 'sale may be required', kind: 'inference', verification: 'unverified', source: 'synthetic' },
    ],
  });
  void echo;
  return buildMorningBrief(db, now);
}

function fact(fieldKey: string, value: string): FactInput {
  return { fieldKey, value, kind: 'fact', verification: 'verified', source: 'synthetic' };
}

function withContact(db: SqlDb, now: Date, input: {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  leadSource: string | null;
  facts: FactInput[];
}): void {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: input.key,
    source: 'synthetic_hot7',
    rawText: `Synthetic Hot 7 ${input.name}`,
    displayName: input.name,
    phone: input.phone,
    email: input.email,
    isDemo: true,
    now,
    facts: input.facts,
  });
  if (!created.clientId || !created.opportunityId) return;
  openBuyerFile(db, { opportunityId: created.opportunityId, now });
  recordLeadSource(db, {
    clientId: created.clientId,
    opportunityId: created.opportunityId,
    sourceSystem: 'synthetic_hot7',
    leadSource: input.leadSource,
    sourceIdentifier: input.key,
    now,
  });
}

function shell(db: SqlDb, now: Date, input: { key: string; name: string; facts: FactInput[] }): void {
  const created = openCanonicalShell(db, {
    idempotencyKey: input.key,
    source: 'synthetic_hot7',
    rawText: `Synthetic Hot 7 ${input.name}. No verified contact.`,
    displayName: input.name,
    status: 'pending_enrichment',
    isDemo: true,
    facts: input.facts,
    now,
  });
  if (!created.clientId || !created.opportunityId) return;
  openBuyerFile(db, { opportunityId: created.opportunityId, now });
  for (const item of input.facts) {
    writeClientFact(db, { clientId: created.clientId, opportunityId: created.opportunityId, fact: item, now });
  }
  recordLeadSource(db, {
    clientId: created.clientId,
    opportunityId: created.opportunityId,
    sourceSystem: 'synthetic_hot7',
    leadSource: null,
    sourceIdentifier: input.key,
    now,
  });
}
