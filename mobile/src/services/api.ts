import Constants from 'expo-constants';
import type { IntakeAnswers, MarketSnapshot, StrategyJson } from '../types/domain';

const API_BASE = Constants.expoConfig?.extra?.apiBaseUrl ?? 'http://localhost:8080';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  getMarket(city: string): Promise<MarketSnapshot> {
    return request<MarketSnapshot>(`/markets/${encodeURIComponent(city)}`);
  },
  getStrategy(payload: { answers: IntakeAnswers; market: MarketSnapshot }): Promise<StrategyJson> {
    return request<StrategyJson>('/strategy', { method: 'POST', body: JSON.stringify(payload) });
  },
  saveClient(payload: { answers: IntakeAnswers; strategy: StrategyJson }): Promise<{ id: string }> {
    return request<{ id: string }>('/clients', { method: 'POST', body: JSON.stringify(payload) });
  },
};
