import OpenAI from 'openai';

function client(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Kleinman Desk drafts do not use OpenAI.');
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM_PROMPT = `You are a real-estate strategy engine. Return JSON only with keys:
leadScore, readinessPercent, summary, arvMath, scripts{marketDropping,ratesHigh,lowInventory}, nextAction.
Never invent unavailable metrics, use \"Not available\" when needed.`;

export async function generateStrategy(payload: unknown) {
  const response = await client().responses.create({
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    text: { format: { type: 'json_object' } },
  });

  const text = response.output_text;
  return JSON.parse(text);
}
