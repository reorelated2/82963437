import React from 'react';
import { Text, View } from 'react-native';
import type { MarketSnapshot, StrategyJson } from '../types/domain';

interface Props {
  market: MarketSnapshot;
  strategy: StrategyJson;
}

export const MarketReportScreen = ({ market, strategy }: Props): React.JSX.Element => (
  <View style={{ padding: 16, gap: 8 }}>
    <Text style={{ fontSize: 24, fontWeight: '700' }}>Market Report</Text>
    <Text>City: {market.city}</Text>
    <Text>Median Price: {market.medianSalePrice ?? 'Not available'}</Text>
    <Text>Median $/sqft: {market.medianPricePerSqft ?? 'Not available'}</Text>
    <Text>DOM: {market.avgDom ?? 'Not available'}</Text>
    <Text>YoY: {market.yoyChangePercent ?? 'Not available'}%</Text>
    <Text>Negotiation Posture: {(market.avgDom ?? 0) > 90 ? 'Aggressive' : 'Conservative'}</Text>
    <Text>Why Now Pitch: {strategy.scripts.marketDropping}</Text>
  </View>
);
