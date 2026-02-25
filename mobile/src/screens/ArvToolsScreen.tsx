import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import type { MarketSnapshot } from '../types/domain';

interface Props {
  market: MarketSnapshot;
  purchasePrice: number;
  rehabBudget: number;
  readinessPercent: number;
}

export const ArvToolsScreen = ({ market, purchasePrice, rehabBudget, readinessPercent }: Props): React.JSX.Element => {
  const arv = useMemo(() => {
    if (!market.medianPricePerSqft) return null;
    const estimate = purchasePrice + rehabBudget;
    const rating = estimate <= market.medianSalePrice! * 0.92 ? 'Strong' : estimate <= market.medianSalePrice! ? 'Moderate' : 'Weak';
    return { estimate, rating };
  }, [market.medianPricePerSqft, market.medianSalePrice, purchasePrice, rehabBudget]);

  const offerStrength = useMemo(() => {
    const domFactor = market.avgDom ? Math.min(5, Math.round(market.avgDom / 25)) : 0;
    const readinessFactor = Math.round(readinessPercent / 20);
    return Math.min(10, readinessFactor + domFactor);
  }, [market.avgDom, readinessPercent]);

  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>ARV + Offer Tools</Text>
      <Text>ARV Estimate: {arv?.estimate ?? 'Not available'}</Text>
      <Text>Deal Rating: {arv?.rating ?? 'Not available'}</Text>
      <Text>Offer Strength Score: {offerStrength}/10</Text>
      <Text>Seller Credit Maximizer: target credits improve as DOM rises above 60.</Text>
    </View>
  );
};
