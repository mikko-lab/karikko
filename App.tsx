import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from './src/constants/colors';
import { isOnboardingDone } from './src/storage/settings';
import OnboardingScreen from './src/screens/OnboardingScreen';
import MapScreen from './src/screens/MapScreen';

export default function App() {
  const [ready, setReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    isOnboardingDone().then((done) => {
      setOnboardingDone(done);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary }}>
        <ActivityIndicator color={Colors.white} size="large" />
      </View>
    );
  }

  if (!onboardingDone) {
    return <OnboardingScreen onDone={() => setOnboardingDone(true)} />;
  }

  return <MapScreen />;
}
