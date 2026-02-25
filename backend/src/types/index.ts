export interface MarketRow {
  city: string;
  state: string;
  property_type: string;
  median_sale_price: number | null;
  median_price_per_sqft: number | null;
  avg_dom: number | null;
  yoy_change_percent: number | null;
  source_url: string;
}
