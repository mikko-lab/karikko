import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  DRAFT: 'vessel_draft_cm',
  ONBOARDING_DONE: 'onboarding_done',
};

export async function getVesselDraft(): Promise<number | null> {
  const val = await AsyncStorage.getItem(KEYS.DRAFT);
  return val ? parseInt(val, 10) : null;
}

export async function setVesselDraft(cm: number): Promise<void> {
  await AsyncStorage.setItem(KEYS.DRAFT, String(cm));
}

export async function isOnboardingDone(): Promise<boolean> {
  const val = await AsyncStorage.getItem(KEYS.ONBOARDING_DONE);
  return val === 'true';
}

export async function markOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(KEYS.ONBOARDING_DONE, 'true');
}
