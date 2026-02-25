import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { ConsultationScreen } from './src/screens/ConsultationScreen';
import { ScoreStrategyScreen } from './src/screens/ScoreStrategyScreen';
import { MarketReportScreen } from './src/screens/MarketReportScreen';
import { ArvToolsScreen } from './src/screens/ArvToolsScreen';
import type { MarketSnapshot, StrategyJson } from './src/types/domain';

const market: MarketSnapshot = {
  city: 'Hialeah',
  state: 'FL',
  propertyType: 'Condo',
  medianSalePrice: 430000,
  medianPricePerSqft: 320,
  avgDom: 76,
  yoyChangePercent: -10.9,
  lastUpdated: new Date().toISOString(),
  sourceUrl: 'https://www.redfin.com/city/7643/FL/Hialeah/housing-market',
};

const strategy: StrategyJson = {
  leadScore: 'WARM',
  readinessPercent: 78,
  summary: 'Buyer has urgency and negotiable market conditions to pursue favorable credits.',
  arvMath: 'Target acquisition under median supports moderate upside after rehab.',
  scripts: {
    marketDropping: 'Smart play—medians dipped, opening spreads for equity grabs. Lock low, ride the rebound.',
    ratesHigh: 'Rates sting, but inventory gives leverage—negotiate seller credits for buydowns. This yields strong NOI.',
    lowInventory: 'Target entry units for quick equity grabs. Cash? We skip contingencies and close fast.',
  },
  nextAction: 'Connect buyer with lender and book a 3-home tour this week.',
};

export default function App(): React.JSX.Element {
  const [clientMode, setClientMode] = useState(false);

  return (
    <ScrollView>
      <View style={{ marginTop: 40 }}>
        <ConsultationScreen />
        <ScoreStrategyScreen
          strategy={strategy}
          clientMode={clientMode}
          onToggleClientMode={() => setClientMode((prev) => !prev)}
        />
        <MarketReportScreen market={market} strategy={strategy} />
        <ArvToolsScreen market={market} purchasePrice={390000} rehabBudget={30000} readinessPercent={strategy.readinessPercent} />
      </View>
    </ScrollView>
  );
}
