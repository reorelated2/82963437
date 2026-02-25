import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MarketSnapshot } from '../types/domain';

const MARKETS_KEY = 'offline:markets:last10';
const CLIENTS_KEY = 'offline:clients:last20';

export const offlineCache = {
  async cacheMarketReport(report: MarketSnapshot): Promise<void> {
    const existing = await this.getMarketReports();
    const merged = [report, ...existing.filter((row) => row.city !== report.city)].slice(0, 10);
    await AsyncStorage.setItem(MARKETS_KEY, JSON.stringify(merged));
  },

  async getMarketReports(): Promise<MarketSnapshot[]> {
    const raw = await AsyncStorage.getItem(MARKETS_KEY);
    return raw ? (JSON.parse(raw) as MarketSnapshot[]) : [];
  },

  async cacheClient(payload: unknown): Promise<void> {
    const raw = await AsyncStorage.getItem(CLIENTS_KEY);
    const existing = raw ? (JSON.parse(raw) as unknown[]) : [];
    const merged = [payload, ...existing].slice(0, 20);
    await AsyncStorage.setItem(CLIENTS_KEY, JSON.stringify(merged));
  },
};
