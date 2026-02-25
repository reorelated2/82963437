import type { IntakeAnswers } from '../types/domain';

const WEIGHTS: Record<keyof IntakeAnswers, Record<string, number>> = {
  motivation: {
    'Job/Relocation': 20,
    'Lease Expiring': 18,
    'Need Space': 14,
    Investing: 16,
    Browsing: 4,
  },
  timeline: { ASAP: 20, '30-60 Days': 16, '60-90 Days': 10, '90+ Days': 5 },
  sellToBuy: { 'Yes-Listed': 12, 'Yes-Unlisted': 8, No: 14, Renting: 10 },
  financing: {
    'Fully Pre-Approved': 20,
    'Pre-Qualified': 14,
    'Need Lender': 8,
    Cash: 20,
  },
  targetCity: { Hialeah: 8, 'Miami Lakes': 8, Custom: 5 },
  propertyType: { SFH: 6, Condo: 5, Townhome: 5, Multi: 8 },
  targetPrice: { 'Under $300K': 6, '$300K-$450K': 8, '$450K-$650K': 8, '$650K+': 6 },
};

export const computeReadinessPercent = (answers: Partial<IntakeAnswers>): number => {
  const max = 100;
  const earned = Object.entries(answers).reduce((sum, [key, value]) => {
    const table = WEIGHTS[key as keyof IntakeAnswers];
    if (!table || !value) return sum;
    return sum + (table[value] ?? 0);
  }, 0);
  return Math.min(max, Math.max(0, Math.round(earned)));
};
