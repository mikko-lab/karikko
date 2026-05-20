import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

export interface WaterStation {
  stationId: number;
  name: string;
  distKm: number;
  levelCm: number;
  measuredAt: string;
}

interface Props {
  station: WaterStation;
}

function getStatus(levelCm: number): { color: string; icon: string; label: string } {
  // Thresholds are relative — without historical baseline we use absolute flags.
  // These will be refined once we add historical comparison.
  if (levelCm < 50) return { color: Colors.danger, icon: '▼▼', label: 'Erittäin matala' };
  if (levelCm < 100) return { color: Colors.warning, icon: '▼', label: 'Matala' };
  return { color: Colors.safe, icon: '●', label: 'Normaali' };
}

export default function WaterLevelBar({ station }: Props) {
  const status = getStatus(station.levelCm);
  const time = new Date(station.measuredAt).toLocaleTimeString('fi-FI', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View
      style={[styles.container, { borderLeftColor: status.color }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Vedenkorkeus: ${station.name}, ${station.levelCm} senttimetriä, ${status.label}, mitattu kello ${time}`}
    >
      <View style={styles.row}>
        <Text style={[styles.icon, { color: status.color }]} aria-hidden>
          {status.icon}
        </Text>
        <Text style={styles.level}>
          <Text style={styles.levelValue}>{station.levelCm} cm</Text>
          {'  '}
          <Text style={styles.statusLabel}>{status.label}</Text>
        </Text>
      </View>
      <Text style={styles.stationName} numberOfLines={1}>
        {station.name} · {station.distKm} km · klo {time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    fontSize: 14,
    fontWeight: '700',
    width: 20,
  },
  level: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  levelValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
  statusLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
  },
  stationName: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
});
