import { formatMoney } from "../os/money.js";
import { clean, nonNegativeNumber, positiveNumber } from "./facts.js";

export type RentalRestriction = "unchecked" | "str_allowed" | "str_limited" | "str_prohibited";

export interface SaleComp {
  address?: string | null;
  closePrice?: number | null;
  closeDate?: string | null;
  source?: string | null;
  condition?: string | null;
}

export interface ActiveListing {
  address?: string | null;
  listPrice?: number | null;
  status?: string | null;
  source?: string | null;
  asOf?: string | null;
}

export interface PricingInput {
  subject?: string | null;
  listings?: ActiveListing[];
  sales?: SaleComp[];
  condition?: string | null;
  hoaMonthly?: number | null;
  assessments?: number | null;
  taxesAnnual?: number | null;
  insuranceAnnual?: number | null;
  financingRateAnnual?: number | null;
  downPayment?: number | null;
  termYears?: number | null;
  price?: number | null;
  repairs?: number | null;
  rentalRestriction?: RentalRestriction | null;
  strIncomeMonthly?: number | null;
  longTermRentMonthly?: number | null;
}

export interface PricingResult {
  sent: false;
  subject: string;
  recommendation: string;
  facts: string[];
  estimates: string[];
  dataNeeded: string[];
  rejected: string[];
  saleRange: { low: number; high: number; median: number; count: number } | null;
  listRange: { low: number; high: number; count: number } | null;
  monthlyCost: number | null;
  cashFlowMonthly: number | null;
  strIncomeUsed: boolean;
  downside: string;
}

interface VerifiedSale {
  address: string;
  closePrice: number;
  closeDate: string;
  source: string;
  condition: string | null;
}

interface VerifiedListing {
  address: string;
  listPrice: number;
  status: string;
  source: string;
  asOf: string;
}

export function monthlyPrincipalAndInterest(principal: number, annualRate: number, years: number): number {
  const months = years * 12;
  if (annualRate === 0) return principal / months;
  const monthly = annualRate / 12;
  const factor = (1 + monthly) ** months;
  return (principal * monthly * factor) / (factor - 1);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function reviewPricing(input: PricingInput): PricingResult {
  const subject = clean(input.subject) ?? "Data needed";
  const facts: string[] = [];
  const estimates: string[] = [];
  const dataNeeded: string[] = [];
  const rejected: string[] = [];

  if (subject === "Data needed") dataNeeded.push("Subject property");

  const sales: VerifiedSale[] = [];
  for (const sale of input.sales ?? []) {
    const address = clean(sale.address);
    const closePrice = positiveNumber(sale.closePrice);
    const closeDate = clean(sale.closeDate);
    const source = clean(sale.source);
    if (!address || closePrice === null || !closeDate || !source) {
      rejected.push("A closed sale was left out because address, price, date, or source was missing.");
      continue;
    }
    sales.push({ address, closePrice, closeDate, source, condition: clean(sale.condition) });
    facts.push(`Closed sale ${address}: ${formatMoney(closePrice)} on ${closeDate}. Source: ${source}.`);
  }

  const listings: VerifiedListing[] = [];
  for (const listing of input.listings ?? []) {
    const address = clean(listing.address);
    const listPrice = positiveNumber(listing.listPrice);
    const status = clean(listing.status);
    const source = clean(listing.source);
    const asOf = clean(listing.asOf);
    if (!address || listPrice === null || !status || !source || !asOf) {
      rejected.push("A listing was left out because address, price, status, source, or as-of date was missing.");
      continue;
    }
    listings.push({ address, listPrice, status, source, asOf });
    facts.push(`Listing ${address}: ${formatMoney(listPrice)}, ${status}, as of ${asOf}. Source: ${source}.`);
  }

  const condition = clean(input.condition);
  const hoa = nonNegativeNumber(input.hoaMonthly);
  const assessments = nonNegativeNumber(input.assessments);
  const taxes = nonNegativeNumber(input.taxesAnnual);
  const insurance = nonNegativeNumber(input.insuranceAnnual);
  const rate = nonNegativeNumber(input.financingRateAnnual);
  const down = nonNegativeNumber(input.downPayment);
  const term = positiveNumber(input.termYears);
  const price = positiveNumber(input.price);
  const repairs = nonNegativeNumber(input.repairs);
  const restriction = input.rentalRestriction ?? null;
  const strIncome = nonNegativeNumber(input.strIncomeMonthly);
  const longTerm = nonNegativeNumber(input.longTermRentMonthly);

  if (condition) facts.push(`Condition note supplied: ${condition}.`);
  else dataNeeded.push("Condition");
  if (hoa !== null) facts.push(`HOA supplied: ${formatMoney(hoa)} a month.`);
  else dataNeeded.push("HOA");
  if (assessments !== null) facts.push(`Assessments supplied: ${formatMoney(assessments)}.`);
  else dataNeeded.push("Assessments");
  if (taxes !== null) facts.push(`Taxes supplied: ${formatMoney(taxes)} a year.`);
  else dataNeeded.push("Taxes");
  if (insurance !== null) facts.push(`Insurance supplied: ${formatMoney(insurance)} a year.`);
  else dataNeeded.push("Insurance");
  if (repairs !== null) facts.push(`Repairs supplied: ${formatMoney(repairs)}.`);
  else dataNeeded.push("Repairs");
  if (rate !== null) facts.push(`Financing rate supplied: ${(rate * 100).toFixed(2)}%.`);
  else dataNeeded.push("Financing rate");

  const salePrices = sales.map((sale) => sale.closePrice);
  const saleRange = salePrices.length
    ? { low: Math.min(...salePrices), high: Math.max(...salePrices), median: median(salePrices), count: salePrices.length }
    : null;
  const listPrices = listings.map((listing) => listing.listPrice);
  const listRange = listPrices.length
    ? { low: Math.min(...listPrices), high: Math.max(...listPrices), count: listPrices.length }
    : null;

  if (saleRange) {
    estimates.push(
      `Unadjusted closed range ${formatMoney(saleRange.low)} to ${formatMoney(saleRange.high)}, median ${formatMoney(saleRange.median)}, from ${saleRange.count} supplied sale${saleRange.count === 1 ? "" : "s"}. Not a CMA. No condition adjustment was applied.`,
    );
    if (saleRange.count < 3) estimates.push("Fewer than 3 closed sales. This is not a pricing opinion.");
  }
  if (listRange) {
    estimates.push(
      `Asking prices supplied: ${formatMoney(listRange.low)} to ${formatMoney(listRange.high)}. Asking price is not a closed value.`,
    );
  }

  let monthlyCost: number | null = null;
  if (price !== null && down !== null && rate !== null && term !== null && taxes !== null && insurance !== null) {
    if (down >= price) {
      rejected.push("Down payment is not below the price, so no loan payment was calculated.");
    } else {
      const principal = price - down;
      const pi = monthlyPrincipalAndInterest(principal, rate, term);
      const hoaPart = hoa ?? 0;
      monthlyCost = pi + taxes / 12 + insurance / 12 + hoaPart;
      estimates.push(
        `Monthly cost estimate ${formatMoney(monthlyCost)} on price ${formatMoney(price)}, down ${formatMoney(down)}, rate ${(rate * 100).toFixed(2)}%, ${term} years. Principal and interest about ${formatMoney(pi)}. This is arithmetic, not a lender quote.`,
      );
      if (hoa === null) estimates.push("HOA was missing and counted as $0 in that monthly figure.");
    }
  } else {
    dataNeeded.push("A full monthly cost needs price, down payment, rate, term, taxes, and insurance");
  }

  let strIncomeUsed = false;
  let rentUsed: number | null = null;
  if (strIncome !== null) {
    if (restriction === "str_allowed") {
      strIncomeUsed = true;
      rentUsed = strIncome;
      facts.push(`Short term rent figure supplied: ${formatMoney(strIncome)} a month. Restriction was marked allowed.`);
      estimates.push("Short term income is the number you supplied. This desk did not verify the rent or the restriction.");
    } else if (restriction === "str_limited") {
      rejected.push("Short term income was not used. The restriction is marked limited and no limit amount was supplied.");
    } else if (restriction === "str_prohibited") {
      rejected.push("Short term income was not used. The restriction is marked prohibited.");
    } else {
      rejected.push("Short term income was not used. Rental restrictions were not checked.");
    }
  }
  if (!strIncomeUsed && longTerm !== null) {
    rentUsed = longTerm;
    facts.push(`Long term rent supplied: ${formatMoney(longTerm)} a month.`);
  } else if (!strIncomeUsed && strIncome === null) {
    dataNeeded.push("Rent, if you want cash flow");
  }

  let cashFlowMonthly: number | null = null;
  if (rentUsed !== null && monthlyCost !== null) {
    cashFlowMonthly = rentUsed - monthlyCost;
    estimates.push(`Cash flow estimate ${formatMoney(cashFlowMonthly)} a month before repairs and vacancy. Rent minus the monthly cost above.`);
  }

  let downside: string;
  if (!saleRange && price === null) {
    downside = "No downside price. No verified closed sale and no subject price were supplied.";
  } else {
    const floor = saleRange ? saleRange.low : price;
    const repairText = repairs !== null ? ` Repairs of ${formatMoney(repairs)} sit on top of that price.` : " Repairs were not supplied.";
    const carry = taxes === null || insurance === null ? " Taxes or insurance are missing, so the carrying-cost downside is incomplete." : "";
    downside = `Downside price in this packet is ${formatMoney(floor ?? 0)}.${repairText}${carry}`;
    estimates.push(downside);
  }

  let recommendation: string;
  if (strIncome !== null && restriction !== "str_allowed") {
    recommendation = "Do not underwrite short term rental income. Check the rental restrictions and use the income only after the rules allow it.";
  } else if (!saleRange && !listRange) {
    recommendation = `Do not price ${subject}. No current listing and no recent closed sale was verified in this packet.`;
  } else if (!saleRange) {
    recommendation = `Do not set a value from asking prices alone. ${subject} has listing data and no verified closed sale.`;
  } else if (saleRange.count < 3 || !condition || taxes === null || insurance === null || repairs === null) {
    recommendation = `Hold the price opinion. Closed sales in this packet run ${formatMoney(saleRange.low)} to ${formatMoney(saleRange.high)}, unadjusted. Fill condition, taxes, insurance, and repairs before you recommend a number.`;
  } else {
    recommendation = `Use ${formatMoney(saleRange.low)} to ${formatMoney(saleRange.high)} as the unadjusted closed range. Do not go below ${formatMoney(saleRange.low)} unless the condition note or the repair number supports it.`;
  }

  if (assessments === null) {
    recommendation += " Assessments are still Data needed.";
  }

  return {
    sent: false,
    subject,
    recommendation,
    facts,
    estimates,
    dataNeeded,
    rejected,
    saleRange,
    listRange,
    monthlyCost,
    cashFlowMonthly,
    strIncomeUsed,
    downside,
  };
}
