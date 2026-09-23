export const CHATGPT_CUSTOM_INSTRUCTIONS = `You are my Redfin Agent-Tools Liaison & virtual Chief of Staff for Miami-Dade & Broward. Convert faster, close more, dominate.
Tone: Calm, confident Miami advisor. Warm, direct, no hype.
Objectives: Convert leads fast. Qualify timeline, pre-approval, must-haves, HOA/insurance. Plain English. Coordinate. Nurture referrals.
Rules: Verify names, prices, dates. Texts ≤3 sentences. Emails 4-6 bullets. No legal advice. Default Brickell if unspecified. Stay confidential.
Redfin Mode: Auto-on for Redfin, lead, or Agent Tools. Fast, property-specific, strong CTA.
Always: 1) One-line recommendation. 2) Three-point rationale. 3) Five-step plan. 4) Client copy in my voice. 5) Insight: value driver + risk. 6) KPI.
Pricing: Aggressive, Market, Conservative — each with price, DOM, and multiple-offer probability.
Templates: First Contact (property-specific + 2 options), Discovery, Timeline, Plain Translation, Nurture.
Save preferences when I say so. Stay proactive, data-driven, focused on closings.`;

export type LeadLabel = 'HOT' | 'WARM' | 'COLD';
export type OfferBand = 'Low' | 'Moderate' | 'High' | 'Not available';

export interface PricingScenario {
  label: 'Aggressive' | 'Market' | 'Conservative';
  price: number | null;
  dom: number | null;
  multipleOfferProbability: OfferBand;
}

export interface LiaisonBrief {
  redfinMode: boolean;
  city: string;
  recommendation: string;
  rationale: [string, string, string];
  actionPlan: [string, string, string, string, string];
  clientCopy: {
    text: string;
    emailBullets: string[];
  };
  insight: {
    valueDriver: string;
    risk: string;
  };
  kpi: string;
  pricingNote: string;
  pricing: [PricingScenario, PricingScenario, PricingScenario];
  templates: {
    firstContact: {
      text: string;
      options: [string, string];
    };
    discoveryQuestions: [string, string, string, string];
    timeline: string;
    plainTranslation: string;
    nurture: string;
  };
}

export interface StrategyJson {
  leadScore: LeadLabel;
  readinessPercent: number;
  summary: string;
  arvMath: string;
  scripts: {
    marketDropping: string;
    ratesHigh: string;
    lowInventory: string;
  };
  nextAction: string;
  liaison: LiaisonBrief;
}

const PROPERTY_LABELS: Record<string, string> = {
  SFH: 'single-family home',
  Condo: 'condo',
  Townhome: 'townhome',
  Multi: 'multi-unit home',
};

const SHOWING_OPTIONS = ['Weekday evening this week', 'Saturday morning this week'] as const;

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0).length;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveMoney(value: unknown): number | null {
  const amount = finiteNumber(value);
  return amount !== null && amount > 0 ? amount : null;
}

function nonNegative(value: unknown): number | null {
  const amount = finiteNumber(value);
  return amount !== null && amount >= 0 ? amount : null;
}

function resolveCity(answersCity: string | undefined, marketCity: string | undefined): string {
  if (answersCity && answersCity !== 'Custom') return answersCity;
  if (marketCity) return marketCity;
  return 'Brickell';
}

function isRedfinMode(message: string | undefined): boolean {
  return /\b(redfin|leads?|agent tools)\b/i.test(message ?? '');
}

function propertyLabel(address: string | undefined, propertyType: string | undefined, city: string): string {
  if (address) return address;
  const noun = PROPERTY_LABELS[propertyType ?? ''] ?? 'home';
  return `the ${noun} in ${city}`;
}

function leadScore(timeline?: string, financing?: string, motivation?: string): LeadLabel {
  if (motivation === 'Browsing' || timeline === '90+ Days') return 'COLD';
  if ((financing === 'Fully Pre-Approved' || financing === 'Cash') && (timeline === 'ASAP' || timeline === '30-60 Days')) {
    return 'HOT';
  }
  return 'WARM';
}

function offerBand(dom: number): Exclude<OfferBand, 'Not available'> {
  if (dom <= 21) return 'High';
  if (dom <= 45) return 'Moderate';
  return 'Low';
}

function shiftBand(band: Exclude<OfferBand, 'Not available'>, delta: number): Exclude<OfferBand, 'Not available'> {
  const order = ['Low', 'Moderate', 'High'] as const;
  const next = Math.min(order.length - 1, Math.max(0, order.indexOf(band) + delta));
  return order[next];
}

function roundToThousand(value: number): number {
  return Math.round(value / 1000) * 1000;
}

function pricingScenarios(base: number | null, dom: number | null): [PricingScenario, PricingScenario, PricingScenario] {
  const band = dom === null ? null : offerBand(dom);
  return [
    {
      label: 'Aggressive',
      price: base === null ? null : roundToThousand(base * 0.97),
      dom: dom === null ? null : dom + 14,
      multipleOfferProbability: band === null ? 'Not available' : shiftBand(band, -1),
    },
    {
      label: 'Market',
      price: base === null ? null : roundToThousand(base),
      dom,
      multipleOfferProbability: band === null ? 'Not available' : band,
    },
    {
      label: 'Conservative',
      price: base === null ? null : roundToThousand(base * 1.02),
      dom: dom === null ? null : Math.max(7, dom - 14),
      multipleOfferProbability: band === null ? 'Not available' : shiftBand(band, 1),
    },
  ];
}

function marketScript(city: string, yoy: number | null): string {
  if (yoy === null) {
    return `Year-over-year change for ${city} is not available. I will not guess the direction. Ask me for the next snapshot before we talk discount.`;
  }
  const direction = yoy < 0 ? 'down' : yoy > 0 ? 'up' : 'flat';
  return `The ${city} snapshot shows the median is ${direction} ${Math.abs(yoy)}% year over year. I will use that only with the days-on-market figure before any offer talk. This is not a promise of future prices.`;
}

function assertInvariants(strategy: StrategyJson): void {
  const { liaison } = strategy;
  const clientTexts = [
    liaison.recommendation,
    liaison.clientCopy.text,
    liaison.templates.firstContact.text,
    liaison.templates.timeline,
    liaison.templates.plainTranslation,
    liaison.templates.nurture,
    strategy.scripts.marketDropping,
    strategy.scripts.ratesHigh,
    strategy.scripts.lowInventory,
  ];
  for (const text of clientTexts) {
    if (countSentences(text) < 1 || countSentences(text) > 3) {
      throw new Error(`Client text must be 1 to 3 sentences: ${text}`);
    }
  }
  if (countSentences(liaison.recommendation) !== 1) {
    throw new Error('Recommendation must be one sentence.');
  }
  if (liaison.clientCopy.emailBullets.length < 4 || liaison.clientCopy.emailBullets.length > 6) {
    throw new Error('Email must be 4 to 6 bullets.');
  }
  if (liaison.rationale.length !== 3 || liaison.actionPlan.length !== 5) {
    throw new Error('Framework shape is incomplete.');
  }
  if (liaison.templates.firstContact.options.length !== 2) {
    throw new Error('First contact needs two options.');
  }
  const labels = liaison.pricing.map((scenario) => scenario.label).join(',');
  if (labels !== 'Aggressive,Market,Conservative') {
    throw new Error('Pricing scenarios are out of order.');
  }
  if (!liaison.templates.plainTranslation.includes('not legal advice')) {
    throw new Error('Plain translation must decline legal advice.');
  }
}

export function collectAmounts(strategy: StrategyJson): number[] {
  return strategy.liaison.pricing.map((scenario) => scenario.price).filter((price): price is number => price !== null);
}

function textIsSafe(text: string, allowedAmounts: number[]): boolean {
  if (/\b(this is legal advice|you are legally|lawsuit|guaranteed appreciation)\b/i.test(text)) return false;
  if (/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i.test(text)) {
    return false;
  }
  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text)) return false;
  const found = text.match(/\$[\d,]+(?:\.\d+)?/g) ?? [];
  return found.every((token) => {
    const value = Number(token.replace(/[$,]/g, ''));
    return allowedAmounts.some((amount) => Math.abs(amount - value) < 1);
  });
}

export function mergeVerifiedStrategy(baseline: StrategyJson, candidate: unknown): StrategyJson {
  const next = structuredClone(baseline);
  const source = asRecord(candidate);
  const liaison = asRecord(source.liaison);
  const allowed = collectAmounts(baseline);
  const clientCopy = asRecord(liaison.clientCopy);
  const templates = asRecord(liaison.templates);
  const insight = asRecord(liaison.insight);
  const scripts = asRecord(source.scripts);

  const apply = (value: unknown, accept: (text: string) => boolean, set: (text: string) => void) => {
    const text = clean(value);
    if (!text || !textIsSafe(text, allowed) || !accept(text)) return;
    set(text);
  };

  apply(liaison.recommendation ?? source.summary, (text) => countSentences(text) === 1, (text) => {
    next.liaison.recommendation = text;
    next.summary = text;
  });

  if (Array.isArray(liaison.rationale) && liaison.rationale.length === 3) {
    const rationale = liaison.rationale.map((item) => clean(item));
    if (rationale.every((item): item is string => Boolean(item) && textIsSafe(item as string, allowed))) {
      next.liaison.rationale = rationale as [string, string, string];
    }
  }

  if (Array.isArray(liaison.actionPlan) && liaison.actionPlan.length === 5) {
    const plan = liaison.actionPlan.map((item) => clean(item));
    if (plan.every((item): item is string => Boolean(item) && textIsSafe(item as string, allowed))) {
      next.liaison.actionPlan = plan as [string, string, string, string, string];
      next.nextAction = plan[0] as string;
    }
  }

  apply(clientCopy.text, (text) => countSentences(text) <= 3, (text) => {
    next.liaison.clientCopy.text = text;
    next.liaison.templates.firstContact.text = text;
  });

  if (Array.isArray(clientCopy.emailBullets)) {
    const bullets = clientCopy.emailBullets.map((item) => clean(item));
    if (
      bullets.length >= 4 &&
      bullets.length <= 6 &&
      bullets.every((item): item is string => Boolean(item) && textIsSafe(item as string, allowed))
    ) {
      next.liaison.clientCopy.emailBullets = bullets as string[];
    }
  }

  apply(insight.valueDriver, () => true, (text) => {
    next.liaison.insight.valueDriver = text;
  });
  apply(insight.risk, () => true, (text) => {
    next.liaison.insight.risk = text;
  });
  apply(liaison.kpi, () => true, (text) => {
    next.liaison.kpi = text;
  });
  apply(templates.timeline, (text) => countSentences(text) <= 3, (text) => {
    next.liaison.templates.timeline = text;
  });
  apply(templates.plainTranslation, (text) => countSentences(text) <= 3 && text.includes('not legal advice'), (text) => {
    next.liaison.templates.plainTranslation = text;
  });
  apply(templates.nurture, (text) => countSentences(text) <= 3, (text) => {
    next.liaison.templates.nurture = text;
  });

  apply(scripts.marketDropping, (text) => countSentences(text) <= 3, (text) => {
    next.scripts.marketDropping = text;
  });
  apply(scripts.ratesHigh, (text) => countSentences(text) <= 3, (text) => {
    next.scripts.ratesHigh = text;
  });
  apply(scripts.lowInventory, (text) => countSentences(text) <= 3, (text) => {
    next.scripts.lowInventory = text;
  });

  try {
    assertInvariants(next);
    return next;
  } catch {
    return baseline;
  }
}

export function buildStrategy(payload: unknown): StrategyJson {
  const root = asRecord(payload);
  const answers = asRecord(root.answers);
  const market = asRecord(root.market);
  const clientName = clean(root.clientName);
  const propertyAddress = clean(root.propertyAddress);
  const message = clean(root.message);
  const timeline = clean(answers.timeline);
  const financing = clean(answers.financing);
  const motivation = clean(answers.motivation);
  const propertyType = clean(answers.propertyType);
  const city = resolveCity(clean(answers.targetCity), clean(market.city));
  const listPrice = positiveMoney(root.listPrice);
  const median = positiveMoney(market.medianSalePrice);
  const base = listPrice ?? median;
  const priceSource = listPrice !== null ? 'list price' : 'median sale price';
  const dom = nonNegative(market.avgDom);
  const yoy = finiteNumber(market.yoyChangePercent);
  const readinessRaw = finiteNumber(root.readinessPercent);
  const readinessPercent = readinessRaw === null ? 0 : Math.min(100, Math.max(0, Math.round(readinessRaw)));
  const label = propertyLabel(propertyAddress, propertyType, city);
  const redfinMode = isRedfinMode(message);
  const greeting = clientName ? `Hi ${clientName}, ` : '';
  const text = `${greeting}I can walk ${label} and put the HOA and insurance numbers in plain English. Two options: a weekday evening this week, or Saturday morning this week. Reply with the one you want me to hold.`;
  const recommendation = redfinMode
    ? `Text this lead now about ${label} and lock one of the two showing options today.`
    : `Send notes on ${label} with two time options, then confirm timeline before any price talk.`;
  const medianText = median === null ? 'Not available' : formatMoney(median);
  const domText = dom === null ? 'Not available' : String(dom);
  const valueDriver =
    dom === null
      ? `Days on market for ${city} are not on file, so I will not guess leverage.`
      : dom > 45
        ? `Days on market in ${city} are ${dom}, which gives the buyer room to negotiate.`
        : `Days on market in ${city} are ${dom}, so speed and clean terms matter more than a deep cut.`;
  const financingRisk =
    !financing || financing === 'Need Lender' || financing === 'Pre-Qualified'
      ? 'Pre-approval is not fully confirmed.'
      : `Financing on file is ${financing}.`;
  const pricingNote =
    base === null
      ? 'No price is on file, so every scenario price is Not available.'
      : `Scenarios use the ${priceSource} of ${formatMoney(base)} on file. They are planning ranges, not an appraisal, and this is not legal advice.`;
  const plainMiddle =
    dom === null
      ? 'Days on market are not on file, so I will not guess who has leverage.'
      : dom > 45
        ? 'Days on market on file are high enough that a buyer can usually ask for more.'
        : 'Days on market on file are tight, so speed matters more than a deep discount.';

  const strategy: StrategyJson = {
    leadScore: leadScore(timeline, financing, motivation),
    readinessPercent,
    summary: recommendation,
    arvMath:
      listPrice !== null && median !== null
        ? `List ${formatMoney(listPrice)} versus median ${formatMoney(median)}. I will not call that an appraisal.`
        : median !== null
          ? `Median on file is ${formatMoney(median)}. Subject-property ARV is not available without a list price.`
          : 'Not available',
    scripts: {
      marketDropping: marketScript(city, yoy),
      ratesHigh:
        'If payment is the worry, seller credits are a maybe only when days on market support them. I will not quote a rate. Your lender has to confirm the payment.',
      lowInventory:
        'If days on market are short, a cleaner offer beats a deep cut. I will not waive anything unless you say so. Send me your must-haves and I will set the next step.',
    },
    nextAction: `Send the property-specific text for ${label} with two time options.`,
    liaison: {
      redfinMode,
      city,
      recommendation,
      rationale: [
        `Timeline on file: ${timeline ?? 'not confirmed'}.`,
        `Financing on file: ${financing ?? 'not confirmed'}.`,
        `Market snapshot for ${city}: median ${medianText}, days on market ${domText}.`,
      ],
      actionPlan: [
        `Send the property-specific text for ${label} with two time options.`,
        'Ask timeline, pre-approval, must-haves, and any HOA or insurance limit.',
        'Translate only the numbers already on file into plain English.',
        'Book the showing or offer review after those answers are in.',
        'If they go quiet, send the nurture note and track the reply.',
      ],
      clientCopy: {
        text,
        emailBullets: [
          `Home: ${label}.`,
          `Client: ${clientName ?? 'Not confirmed'}.`,
          `Timeline on file: ${timeline ?? 'not confirmed'}.`,
          `Financing on file: ${financing ?? 'not confirmed'}.`,
          `Reply with must-haves and any HOA or insurance cap. Options: ${SHOWING_OPTIONS.join(' or ')}.`,
        ],
      },
      insight: {
        valueDriver,
        risk: `${financingRisk} HOA and insurance figures stay unconfirmed until they are on file.`,
      },
      kpi: 'Minutes to first reply, then whether a showing time is confirmed.',
      pricingNote,
      pricing: pricingScenarios(base, dom),
      templates: {
        firstContact: {
          text,
          options: [...SHOWING_OPTIONS],
        },
        discoveryQuestions: [
          'What date do you need to be in the home?',
          'Are you fully pre-approved, pre-qualified, or still choosing a lender?',
          'Which three must-haves are non-negotiable?',
          'Is there an HOA monthly cap or insurance concern I should price in before we tour?',
        ],
        timeline: timeline
          ? `You said ${timeline}. I will plan around that and I will not put a contract date down until you confirm it.`
          : 'Timeline is not confirmed. I will ask before I suggest any contract date.',
        plainTranslation: `I will only quote a price, a date, or a name that is already on file. ${plainMiddle} This is not legal advice.`,
        nurture: `I will check back with homes in ${city} that match what you already told me. Reply if your timeline or must-haves change, or tell me to pause. I will not add you to a blast list.`,
      },
    },
  };

  assertInvariants(strategy);
  return strategy;
}
