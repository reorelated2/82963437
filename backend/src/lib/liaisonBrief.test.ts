import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHATGPT_CUSTOM_INSTRUCTIONS,
  buildStrategy,
  countSentences,
  mergeVerifiedStrategy,
} from './liaisonBrief.js';

const instructionsFile = join(dirname(fileURLToPath(import.meta.url)), '../../../prompts/chatgpt-custom-instructions.txt');

test('custom instructions stay inside the ChatGPT character limit', () => {
  const pasted = readFileSync(instructionsFile, 'utf8').trimEnd();
  assert.equal(CHATGPT_CUSTOM_INSTRUCTIONS, pasted);
  assert.ok(CHATGPT_CUSTOM_INSTRUCTIONS.length < 1000);
  assert.equal(CHATGPT_CUSTOM_INSTRUCTIONS.length, 997);
});

test('unspecified city defaults to Brickell and does not invent a price or name', () => {
  const strategy = buildStrategy({});
  const serialized = JSON.stringify(strategy);
  assert.equal(strategy.liaison.city, 'Brickell');
  assert.equal(strategy.liaison.redfinMode, false);
  assert.equal(strategy.liaison.pricing.every((scenario) => scenario.price === null), true);
  assert.equal(strategy.liaison.pricing.every((scenario) => scenario.multipleOfferProbability === 'Not available'), true);
  assert.equal(serialized.includes('$'), false);
  assert.equal(/\b(Kyle|Alex|Maria|John)\b/.test(serialized), false);
  assert.equal(strategy.arvMath, 'Not available');
});

test('Redfin lead uses the property city, verified median, and short client copy', () => {
  const strategy = buildStrategy({
    message: 'Redfin lead from Agent Tools',
    clientName: 'Maria',
    answers: {
      timeline: '30-60 Days',
      financing: 'Need Lender',
      motivation: 'Lease Expiring',
      propertyType: 'Condo',
      targetCity: 'Hialeah',
    },
    market: {
      city: 'Hialeah',
      medianSalePrice: 430000,
      avgDom: 76,
      yoyChangePercent: -10.9,
    },
    readinessPercent: 78,
  });

  assert.equal(strategy.liaison.redfinMode, true);
  assert.equal(strategy.liaison.city, 'Hialeah');
  assert.equal(strategy.leadScore, 'WARM');
  assert.equal(strategy.readinessPercent, 78);
  assert.equal(countSentences(strategy.liaison.clientCopy.text), 3);
  assert.equal(strategy.liaison.clientCopy.text.startsWith('Hi Maria,'), true);
  assert.ok(strategy.liaison.clientCopy.emailBullets.length >= 4);
  assert.ok(strategy.liaison.clientCopy.emailBullets.length <= 6);
  assert.deepEqual(
    strategy.liaison.pricing.map((scenario) => scenario.label),
    ['Aggressive', 'Market', 'Conservative'],
  );
  assert.deepEqual(
    strategy.liaison.pricing.map((scenario) => scenario.price),
    [417000, 430000, 439000],
  );
  assert.equal(strategy.liaison.pricing[1].dom, 76);
  assert.equal(strategy.liaison.pricing[1].multipleOfferProbability, 'Low');
  assert.match(strategy.liaison.templates.plainTranslation, /not legal advice/i);
  assert.equal(strategy.liaison.templates.firstContact.options.length, 2);
});

test('model copy cannot introduce an unverified price', () => {
  const baseline = buildStrategy({
    market: { city: 'Hialeah', medianSalePrice: 430000, avgDom: 76 },
  });
  const merged = mergeVerifiedStrategy(baseline, {
    liaison: {
      recommendation: 'Offer $999,999 today and we are guaranteed appreciation.',
      clientCopy: { text: 'The real price is $400,000. Call me. See you January 4.' },
    },
  });
  assert.equal(merged.liaison.recommendation, baseline.liaison.recommendation);
  assert.equal(merged.liaison.clientCopy.text, baseline.liaison.clientCopy.text);
  assert.equal(merged.liaison.pricing[1].price, 430000);
});

test('a safe one-line recommendation can replace the baseline line', () => {
  const baseline = buildStrategy({ message: 'lead', market: { city: 'Hialeah', medianSalePrice: 430000, avgDom: 76 } });
  const merged = mergeVerifiedStrategy(baseline, {
    liaison: {
      recommendation: 'Text this lead about the Hialeah condo and hold one of the two times.',
    },
  });
  assert.equal(merged.summary, 'Text this lead about the Hialeah condo and hold one of the two times.');
  assert.equal(merged.liaison.pricing[0].price, baseline.liaison.pricing[0].price);
});
