import OpenAI from 'openai';
import { CHATGPT_CUSTOM_INSTRUCTIONS, buildStrategy, mergeVerifiedStrategy, type StrategyJson } from './liaisonBrief.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `${CHATGPT_CUSTOM_INSTRUCTIONS}

Return JSON only. Use the liaison framework on every reply. Quote a name, price, or date only when it is in the user payload. If a figure is missing, say Not available. Do not give legal advice. Texts stay within 3 sentences. Emails stay within 4 to 6 bullets. Keep Aggressive, Market, and Conservative pricing tied to supplied figures.`;

export async function generateStrategy(payload: unknown): Promise<StrategyJson> {
  const baseline = buildStrategy(payload);
  if (!process.env.OPENAI_API_KEY) return baseline;

  try {
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      text: { format: { type: 'json_object' } },
    });
    return mergeVerifiedStrategy(baseline, JSON.parse(response.output_text) as unknown);
  } catch {
    return baseline;
  }
}
