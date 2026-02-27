import React, { useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { computeReadinessPercent } from '../services/intake';
import { ROCKET_MORTGAGE_ONE_PLUS_SCRIPT, shouldShowRocketCta } from '../services/rocketScript';
import type { IntakeAnswers } from '../types/domain';

const seed: Partial<IntakeAnswers> = {
  motivation: 'Lease Expiring',
  timeline: '30-60 Days',
  sellToBuy: 'No',
  financing: 'Need Lender',
  targetCity: 'Hialeah',
  propertyType: 'Condo',
  targetPrice: '$300K-$450K',
};

export const ConsultationScreen = (): React.JSX.Element => {
  const [answers, setAnswers] = useState<Partial<IntakeAnswers>>(seed);
  const readiness = useMemo(() => computeReadinessPercent(answers), [answers]);

  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Initial Buyer Consultation</Text>
      <Text>Voice-to-form mode and rapid tap mode write into the same intake schema.</Text>
      <Button title="Simulate Voice Brain Dump Autofill" onPress={() => setAnswers(seed)} />
      <Text>Buyer Readiness Meter: {readiness}%</Text>
      {shouldShowRocketCta(answers) ? (
        <View style={{ borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <Text style={{ fontWeight: '700', marginBottom: 8 }}>Rocket Mortgage CTA</Text>
          <Text>{ROCKET_MORTGAGE_ONE_PLUS_SCRIPT}</Text>
        </View>
      ) : null}
    </View>
  );
};
