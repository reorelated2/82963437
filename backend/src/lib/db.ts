import { createClient } from '@supabase/supabase-js';
import type { MarketRow } from '../types';

const supabase = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');

export async function upsertMarkets(rows: MarketRow[]): Promise<void> {
  await supabase.from('markets').upsert(
    rows.map((row) => ({
      ...row,
      last_updated: new Date().toISOString(),
    })),
    { onConflict: 'city,state,property_type' },
  );
}

export async function getMarket(city: string): Promise<MarketRow | null> {
  const { data } = await supabase
    .from('markets')
    .select('*')
    .eq('city', city)
    .order('last_updated', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as MarketRow | null;
}

export async function saveClient(payload: { answers: unknown; leadLabel: string; readinessPercent: number; transactionPlan: unknown }): Promise<string> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      answers_json: payload.answers,
      lead_label: payload.leadLabel,
      readiness_percent: payload.readinessPercent,
      transaction_plan: payload.transactionPlan,
    })
    .select('id')
    .single();

  if (error) throw error;
  return String(data.id);
}
