export type City = 'Hialeah' | 'Miami Lakes' | 'Custom';

export type LeadLabel = 'HOT' | 'WARM' | 'COLD';

export interface IntakeAnswers {
  motivation: 'Job/Relocation' | 'Lease Expiring' | 'Need Space' | 'Investing' | 'Browsing';
  timeline: 'ASAP' | '30-60 Days' | '60-90 Days' | '90+ Days';
  sellToBuy: 'Yes-Listed' | 'Yes-Unlisted' | 'No' | 'Renting';
  financing: 'Fully Pre-Approved' | 'Pre-Qualified' | 'Need Lender' | 'Cash';
  targetCity: City;
  propertyType: 'SFH' | 'Condo' | 'Townhome' | 'Multi';
  targetPrice: 'Under $300K' | '$300K-$450K' | '$450K-$650K' | '$650K+';
}

export interface MarketSnapshot {
  city: string;
  state: string;
  propertyType: string;
  medianSalePrice: number | null;
  medianPricePerSqft: number | null;
  avgDom: number | null;
  yoyChangePercent: number | null;
  lastUpdated: string;
  sourceUrl: string;
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
}
