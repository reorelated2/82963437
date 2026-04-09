export type ListingStatus = 'active' | 'pending' | 'under_contract' | 'sold';

export interface MlsListing {
  mlsId: string;
  address: string;
  zip: string;
  listPrice: number;
  status: ListingStatus;
  propertyType: 'duplex' | 'triplex' | 'fourplex' | 'single_family' | 'other';
  dom: number;
  priceCutPercent?: number;
  contractFellThrough?: boolean;
  shortSale?: boolean;
  pricePerSqft?: number;
  units?: number;
}

export interface AnalyzerConfig {
  targetZip: string;
  maxBudget: number;
}

export interface RankedListing extends MlsListing {
  score: number;
  signals: string[];
}

export interface AnalyzerResult {
  totals: {
    allListings: number;
    inZoneAndBudget: number;
    active: number;
    underContractFilteredOut: number;
  };
  topSignals: RankedListing[];
  ranked: RankedListing[];
}

const DEFAULT_CONFIG: AnalyzerConfig = {
  targetZip: '33127',
  maxBudget: 550_000,
};

function mergeAndDeduplicate(feeds: MlsListing[][]): MlsListing[] {
  const map = new Map<string, MlsListing>();

  for (const feed of feeds) {
    for (const listing of feed) {
      const key = `${listing.mlsId}-${listing.address.toLowerCase().trim()}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, listing);
        continue;
      }

      map.set(key, {
        ...existing,
        ...listing,
        dom: Math.max(existing.dom, listing.dom),
        priceCutPercent: Math.max(existing.priceCutPercent ?? 0, listing.priceCutPercent ?? 0) || undefined,
        contractFellThrough: Boolean(existing.contractFellThrough || listing.contractFellThrough),
        shortSale: Boolean(existing.shortSale || listing.shortSale),
      });
    }
  }

  return [...map.values()];
}

function toRanked(listing: MlsListing): RankedListing {
  let score = 0;
  const signals: string[] = [];

  if (listing.contractFellThrough) {
    score += 55;
    signals.push('Contract fell through, back to active');
  }
  if (listing.shortSale) {
    score += 50;
    signals.push('Pending short sale reverted to active');
  }
  if ((listing.priceCutPercent ?? 0) >= 10) {
    score += 40;
    signals.push(`${listing.priceCutPercent}% price cut`);
  } else if ((listing.priceCutPercent ?? 0) > 0) {
    score += Math.round((listing.priceCutPercent ?? 0) * 2);
    signals.push(`${listing.priceCutPercent}% price cut`);
  }
  if (listing.dom >= 365) {
    score += 35;
    signals.push(`${listing.dom} DOM (long exposure)`);
  } else if (listing.dom >= 120) {
    score += 20;
    signals.push(`${listing.dom} DOM`);
  }

  if (listing.propertyType === 'duplex' || listing.propertyType === 'triplex' || listing.propertyType === 'fourplex') {
    score += 10;
    signals.push('Multifamily in core zone');
  }

  if (listing.listPrice <= 400_000) {
    score += 10;
  }

  return {
    ...listing,
    score,
    signals,
  };
}

export function analyzeMlsFeeds(feeds: MlsListing[][], config: Partial<AnalyzerConfig> = {}): AnalyzerResult {
  const finalConfig: AnalyzerConfig = { ...DEFAULT_CONFIG, ...config };
  const merged = mergeAndDeduplicate(feeds);

  const inZoneAndBudget = merged.filter(
    (listing) => listing.zip === finalConfig.targetZip && listing.listPrice <= finalConfig.maxBudget,
  );

  const active = inZoneAndBudget.filter((listing) => listing.status === 'active');
  const underContractFilteredOut = inZoneAndBudget.filter((listing) => listing.status === 'under_contract').length;

  const ranked = active.map(toRanked).sort((a, b) => b.score - a.score || a.listPrice - b.listPrice);

  return {
    totals: {
      allListings: merged.length,
      inZoneAndBudget: inZoneAndBudget.length,
      active: active.length,
      underContractFilteredOut,
    },
    topSignals: ranked.slice(0, 6),
    ranked,
  };
}

const HIRAM_ZONE_SEED: MlsListing[] = [
  { mlsId: 'A11961302', address: '4719 NW 32nd Ave', zip: '33127', listPrice: 448000, status: 'active', propertyType: 'duplex', dom: 74, contractFellThrough: true },
  { mlsId: 'A11922821', address: '2912 NW 32nd St', zip: '33127', listPrice: 500000, status: 'active', propertyType: 'triplex', dom: 92, shortSale: true },
  { mlsId: 'A11951982', address: '1786 NW 53rd St', zip: '33127', listPrice: 500000, status: 'active', propertyType: 'duplex', dom: 67, priceCutPercent: 10 },
  { mlsId: 'A11942234', address: '5752 NW 1st Ave', zip: '33127', listPrice: 535000, status: 'active', propertyType: 'duplex', dom: 425 },
  { mlsId: 'A11919729', address: '105 NW 58th St', zip: '33127', listPrice: 539000, status: 'active', propertyType: 'triplex', dom: 136, pricePerSqft: 284, units: 3 },
  { mlsId: 'A11985304', address: '5631 NW 5th Ct', zip: '33127', listPrice: 349900, status: 'active', propertyType: 'duplex', dom: 121 },
  { mlsId: 'A11973011', address: '4901 NW 29th Ave', zip: '33127', listPrice: 525000, status: 'active', propertyType: 'duplex', dom: 88 },
  { mlsId: 'A11974410', address: '4529 NW 31st Ave', zip: '33127', listPrice: 520000, status: 'active', propertyType: 'duplex', dom: 52, priceCutPercent: 4 },
  { mlsId: 'A11974411', address: '4541 NW 31st Ave', zip: '33127', listPrice: 515000, status: 'active', propertyType: 'duplex', dom: 50 },
  { mlsId: 'A11974412', address: '4553 NW 31st Ave', zip: '33127', listPrice: 510000, status: 'active', propertyType: 'duplex', dom: 47 },
  { mlsId: 'A11974413', address: '4565 NW 31st Ave', zip: '33127', listPrice: 505000, status: 'active', propertyType: 'duplex', dom: 43 },
  { mlsId: 'A11974414', address: '4577 NW 31st Ave', zip: '33127', listPrice: 499000, status: 'active', propertyType: 'duplex', dom: 40 },
  { mlsId: 'A11974415', address: '4589 NW 31st Ave', zip: '33127', listPrice: 489000, status: 'active', propertyType: 'duplex', dom: 39 },
  { mlsId: 'A11974416', address: '4601 NW 31st Ave', zip: '33127', listPrice: 479000, status: 'active', propertyType: 'duplex', dom: 35, priceCutPercent: 3 },
  { mlsId: 'A11974417', address: '4613 NW 31st Ave', zip: '33127', listPrice: 469000, status: 'active', propertyType: 'duplex', dom: 32 },
  { mlsId: 'A11974418', address: '4625 NW 31st Ave', zip: '33127', listPrice: 459000, status: 'active', propertyType: 'duplex', dom: 31 },
  { mlsId: 'A11974419', address: '4637 NW 31st Ave', zip: '33127', listPrice: 449000, status: 'active', propertyType: 'duplex', dom: 29 },
  { mlsId: 'A11974420', address: '4649 NW 31st Ave', zip: '33127', listPrice: 439000, status: 'active', propertyType: 'duplex', dom: 27 },
  { mlsId: 'A11974421', address: '4661 NW 31st Ave', zip: '33127', listPrice: 429000, status: 'under_contract', propertyType: 'duplex', dom: 19 },
  { mlsId: 'A11974422', address: '4673 NW 31st Ave', zip: '33127', listPrice: 419000, status: 'under_contract', propertyType: 'duplex', dom: 17 },
];

export function getHiramSeedAnalysis(): AnalyzerResult {
  return analyzeMlsFeeds([HIRAM_ZONE_SEED]);
}
