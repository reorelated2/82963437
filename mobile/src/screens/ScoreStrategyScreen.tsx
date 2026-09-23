import React from 'react';
import { Button, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { formatMoney } from '../services/liaisonBrief';
import type { StrategyJson } from '../types/domain';

interface Props {
  strategy: StrategyJson;
  clientMode: boolean;
  onToggleClientMode: () => void;
}

const showPrice = (price: number | null): string => (price === null ? 'Not available' : formatMoney(price));
const showDom = (dom: number | null): string => (dom === null ? 'Not available' : String(dom));

export const ScoreStrategyScreen = ({ strategy, clientMode, onToggleClientMode }: Props): React.JSX.Element => {
  const brief = strategy.liaison;
  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Redfin Liaison Brief</Text>
      {!clientMode ? <Text>Lead Label: {strategy.leadScore}</Text> : null}
      <Text style={{ fontWeight: '700' }}>One-Line Recommendation</Text>
      <Text>{brief.recommendation}</Text>
      {!clientMode ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: '700' }}>Three-Point Rationale</Text>
          {brief.rationale.map((point) => (
            <Text key={point}>{point}</Text>
          ))}
          <Text style={{ fontWeight: '700' }}>Five-Step Action Plan</Text>
          {brief.actionPlan.map((step, index) => (
            <Text key={step}>{index + 1}. {step}</Text>
          ))}
        </View>
      ) : null}
      <Text style={{ fontWeight: '700' }}>Client-Ready Text</Text>
      <Text>{brief.clientCopy.text}</Text>
      <Text style={{ fontWeight: '700' }}>Email</Text>
      {brief.clientCopy.emailBullets.map((bullet) => (
        <Text key={bullet}>• {bullet}</Text>
      ))}
      <Text style={{ fontWeight: '700' }}>Pricing</Text>
      <Text>{brief.pricingNote}</Text>
      {brief.pricing.map((scenario) => (
        <Text key={scenario.label}>
          {scenario.label}: {showPrice(scenario.price)} · DOM {showDom(scenario.dom)} · Multiple-offer {scenario.multipleOfferProbability}
        </Text>
      ))}
      {!clientMode ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: '700' }}>Key Insight</Text>
          <Text>Value: {brief.insight.valueDriver}</Text>
          <Text>Risk: {brief.insight.risk}</Text>
          <Text style={{ fontWeight: '700' }}>KPI</Text>
          <Text>{brief.kpi}</Text>
          <Text style={{ fontWeight: '700' }}>First Contact Options</Text>
          {brief.templates.firstContact.options.map((option) => (
            <Text key={option}>{option}</Text>
          ))}
          <Text style={{ fontWeight: '700' }}>Discovery</Text>
          {brief.templates.discoveryQuestions.map((question) => (
            <Text key={question}>{question}</Text>
          ))}
          <Text style={{ fontWeight: '700' }}>Timeline</Text>
          <Text>{brief.templates.timeline}</Text>
          <Text style={{ fontWeight: '700' }}>Plain Translation</Text>
          <Text>{brief.templates.plainTranslation}</Text>
          <Text style={{ fontWeight: '700' }}>Nurture</Text>
          <Text>{brief.templates.nurture}</Text>
        </View>
      ) : null}
      <Button title="Read Script" onPress={() => Speech.speak(brief.clientCopy.text)} />
      <Button title={clientMode ? 'Disable Client Mode' : 'Enable Client Mode'} onPress={onToggleClientMode} />
    </View>
  );
};
