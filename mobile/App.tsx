import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { buildStrategy } from './src/services/liaisonBrief';
import { ConsultationScreen } from './src/screens/ConsultationScreen';
import { ScoreStrategyScreen } from './src/screens/ScoreStrategyScreen';
import { MarketReportScreen } from './src/screens/MarketReportScreen';
import { ArvToolsScreen } from './src/screens/ArvToolsScreen';
import type { IntakeAnswers, MarketSnapshot } from './src/types/domain';
import { computeReadinessPercent } from './src/services/intake';

const seed: IntakeAnswers = {
  motivation: 'Lease Expiring',
  timeline: '30-60 Days',
  sellToBuy: 'No',
  financing: 'Need Lender',
  targetCity: 'Hialeah',
  propertyType: 'Condo',
  targetPrice: '$300K-$450K',
};

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

export default function App(): React.JSX.Element {
  const [clientMode, setClientMode] = useState(false);
  const [answers, setAnswers] = useState<Partial<IntakeAnswers>>(seed);
  const strategy = useMemo(
    () =>
      buildStrategy({
        message: 'Redfin lead from Agent Tools',
        answers,
        market: {
          city: answers.targetCity && answers.targetCity !== 'Custom' ? answers.targetCity : market.city,
          medianSalePrice: market.medianSalePrice,
          avgDom: market.avgDom,
          yoyChangePercent: market.yoyChangePercent,
        },
        readinessPercent: computeReadinessPercent(answers),
      }),
    [answers],
  );

  return (
    <ScrollView>
      <View style={{ marginTop: 40 }}>
        <ConsultationScreen answers={answers} onChange={setAnswers} />
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
