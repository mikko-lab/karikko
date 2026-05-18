import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Colors } from '../constants/colors';
import { markOnboardingDone, setVesselDraft } from '../storage/settings';

interface Props {
  onDone: () => void;
}

export default function OnboardingScreen({ onDone }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  async function handleContinue() {
    const cm = parseInt(draft, 10);
    if (!draft || isNaN(cm) || cm < 5 || cm > 500) {
      setError('Anna syväys senttimetreissä (5–500 cm)');
      return;
    }
    await setVesselDraft(cm);
    await markOnboardingDone();
    onDone();
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>⚓</Text>
        <Text style={styles.title}>KARIKKO</Text>
        <Text style={styles.subtitle}>Matalikkovaroitin Suomen vesille</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Aluksesi syväys (cm)</Text>
          <Text style={styles.hint}>
            Kippari tietää tämän — tai arvioi. Voit muuttaa myöhemmin.
          </Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(t) => { setDraft(t); setError(''); }}
            keyboardType="number-pad"
            placeholder="esim. 80"
            placeholderTextColor={Colors.textMuted}
            maxLength={3}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.safetyNote}>
            Sovellus varoittaa kun syvyys {'<'} syväys + 50 cm turvamarginaali
          </Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Aloita</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: {
    fontSize: 64,
    marginBottom: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 48,
    marginTop: 4,
  },
  form: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 12,
  },
  input: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 14,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  error: {
    color: '#FFB3B3',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  safetyNote: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 48,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
});
