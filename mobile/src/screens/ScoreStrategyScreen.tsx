import React from 'react';
import { Button, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import type { StrategyJson } from '../types/domain';

interface Props {
  strategy: StrategyJson;
  clientMode: boolean;
  onToggleClientMode: () => void;
}

export const ScoreStrategyScreen = ({ strategy, clientMode, onToggleClientMode }: Props): React.JSX.Element => {
  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Score + Strategy</Text>
      {!clientMode ? <Text>Lead Label: {strategy.leadScore}</Text> : null}
      <Text>Summary: {strategy.summary}</Text>
      <Text>Next Action: {strategy.nextAction}</Text>
      <Button title="Read Script" onPress={() => Speech.speak(strategy.scripts.ratesHigh)} />
      <Button title={clientMode ? 'Disable Client Mode' : 'Enable Client Mode'} onPress={onToggleClientMode} />
    </View>
  );
};
