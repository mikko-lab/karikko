import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Platform,
  Linking,
} from 'react-native';
import {
  Map,
  Camera,
  Marker,
  GeoJSONSource,
  Layer,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Colors } from '../constants/colors';
import { getVesselDraft } from '../storage/settings';
import { insertHazard, getNearbyHazards, Hazard } from '../storage/db';
import WaterLevelBar, { WaterStation } from '../components/WaterLevelBar';

const API_BASE = 'https://karikko-api.vercel.app';

type HazardThreat = 'danger' | 'caution' | 'safe';

function getHazardThreat(depthCm: number | null | undefined, draftCm: number): HazardThreat {
  if (depthCm == null) return 'caution'; // tuntematon syvyys → tarkkaile
  if (depthCm <= draftCm) return 'danger';
  if (depthCm <= draftCm + 50) return 'caution';
  return 'safe';
}

const THREAT_STYLE: Record<HazardThreat, { bg: string; icon: string; label: string }> = {
  danger:  { bg: Colors.danger,  icon: '⚠', label: 'Vaarallinen' },
  caution: { bg: Colors.warning, icon: '⚠', label: 'Tarkkaile' },
  safe:    { bg: '#4A4A4A',      icon: '⚠', label: 'Ei uhkaa' },
};

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

function toFinnishStyle(style: any): any {
  if (!style?.layers) return style;
  return {
    ...style,
    layers: style.layers.map((layer: any) => {
      if (layer.type !== 'symbol' || !layer.layout?.['text-field']) return layer;
      return {
        ...layer,
        layout: {
          ...layer.layout,
          'text-field': ['coalesce', ['get', 'name:fi'], ['get', 'name']],
        },
      };
    }),
  };
}

export default function MapScreen() {
  const [mapStyle, setMapStyle] = useState<any>(null);

  useEffect(() => {
    fetch(MAP_STYLE_URL)
      .then((r) => r.json())
      .then((style) => setMapStyle(toFinnishStyle(style)))
      .catch(() => setMapStyle(MAP_STYLE_URL));
  }, []);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [draftCm, setDraftCm] = useState<number>(80);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reportDepth, setReportDepth] = useState('');
  const [waterStation, setWaterStation] = useState<WaterStation | null>(null);
  const [fairwayLines, setFairwayLines] = useState<any>(null);
  const [shallowAreas, setShallowAreas] = useState<any>(null);
  const [hazardsLoading, setHazardsLoading] = useState(false);
  const cameraRef = useRef<CameraRef>(null);
  const hasFollowed = useRef(false);
  const FINLAND_DEFAULT = { center: [25.0, 60.2] as [number, number], zoom: 7 };

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Sijaintilupa puuttuu', 'KARIKKO tarvitsee sijainnin toimiakseen.');
        return;
      }
      const draft = await getVesselDraft();
      if (draft) setDraftCm(draft);

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 },
        async (loc) => {
          setLocation(loc);
          if (!hasFollowed.current) {
            hasFollowed.current = true;
            cameraRef.current?.flyTo({
              center: [loc.coords.longitude, loc.coords.latitude],
              zoom: 13,
              duration: 800,
            });
          }
          fetchHazards(loc.coords.latitude, loc.coords.longitude);
          fetchWaterLevel(loc.coords.latitude, loc.coords.longitude);
          fetchFairways(loc.coords.latitude, loc.coords.longitude);
        }
      );
    })();

    return () => { sub?.remove(); };
  }, []);

  async function fetchHazards(lat: number, lon: number) {
    setHazardsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/hazards?lat=${lat}&lon=${lon}`);
      if (res.ok) {
        const data = await res.json();
        setHazards(data);
        return;
      }
    } catch {
      // offline — fallback paikalliseen SQLiteen
    } finally {
      setHazardsLoading(false);
    }
    const local = await getNearbyHazards(lat, lon);
    setHazards(local);
  }

  async function fetchFairways(lat: number, lon: number) {
    try {
      const res = await fetch(`${API_BASE}/api/fairways?lat=${lat}&lon=${lon}&radius=0.05`);
      if (!res.ok) return;
      const data = await res.json();
      const lines = data.lines ?? [];
      if (lines.length > 0) {
        setFairwayLines({
          type: 'FeatureCollection',
          features: lines.map((l: any) => ({
            type: 'Feature',
            geometry: l.geometry,
            properties: { name: l.name, depth: l.designDepthM },
          })),
        });
      }

      const shallowFeatures = (data.fairways ?? [])
        .filter((f: any) => f.designDepthM !== null && f.designDepthM <= 1.5)
        .map((f: any) => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: { depth: f.designDepthM, name: f.name },
        }));
      if (shallowFeatures.length > 0) {
        setShallowAreas({ type: 'FeatureCollection', features: shallowFeatures });
      }
    } catch {
      // offline — säilytetään vanha data
    }
  }

  async function fetchWaterLevel(lat: number, lon: number) {
    try {
      const res = await fetch(`${API_BASE}/api/water-level?lat=${lat}&lon=${lon}`);
      if (!res.ok) return;
      const data = await res.json();
      const first = data.stations?.[0];
      if (first && first.distKm <= 25) setWaterStation(first);
    } catch {
      // offline tai verkkovirhe — näytetään vanha arvo jos on
    }
  }

  async function handleReportHazard() {
    if (!location) {
      Alert.alert('Sijainti ei saatavilla', 'Odota että GPS löytyy.');
      return;
    }
    setReportModalVisible(true);
  }

  async function submitReport() {
    if (!location) return;
    const depth = reportDepth ? parseInt(reportDepth, 10) : undefined;
    const body = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      depth_cm: depth ?? null,
      note: reportNote || null,
    };
    setReportModalVisible(false);
    setReportNote('');
    setReportDepth('');

    // Tallennetaan paikallisesti heti (offline-tuki)
    await insertHazard({ latitude: body.latitude, longitude: body.longitude, depth_cm: depth, note: body.note ?? undefined });

    // Lähetetään backendiin taustalla
    fetch(`${API_BASE}/api/hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {/* offline — paikallinen kopio riittää */});

    Alert.alert('Kiitos!', 'Matalikkomerkintä tallennettu.');
    fetchHazards(location.coords.latitude, location.coords.longitude);
  }

  if (!mapStyle) return (
    <View style={[styles.container, { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary }]}>
      <Text style={{ color: Colors.white }}>Ladataan karttaa…</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={mapStyle}>
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: FINLAND_DEFAULT.center,
            zoom: FINLAND_DEFAULT.zoom,
          }}
        />
        {location && (
          <Marker
            id="vessel"
            lngLat={[location.coords.longitude, location.coords.latitude]}
          >
            <View
              style={[
                styles.vesselMarker,
                {
                  transform: [{
                    rotate: `${location.coords.heading ?? 0}deg`,
                  }],
                },
              ]}
              accessible
              accessibilityLabel="Oma alus"
            >
              <View style={styles.vesselTriangle} />
            </View>
          </Marker>
        )}
        {shallowAreas && (
          <GeoJSONSource id="shallow-areas" data={shallowAreas}>
            <Layer
              id="shallow-fill"
              type="fill"
              paint={{
                'fill-color': Colors.warning,
                'fill-opacity': 0.25,
              }}
            />
            <Layer
              id="shallow-outline"
              type="line"
              paint={{
                'line-color': Colors.warning,
                'line-width': 1.5,
              }}
            />
          </GeoJSONSource>
        )}
        {fairwayLines && (
          <GeoJSONSource id="fairways" data={fairwayLines}>
            <Layer
              id="fairway-lines"
              type="line"
              paint={{
                'line-color': '#000000',
                'line-width': 2,
                'line-dasharray': [4, 3],
              }}
            />
          </GeoJSONSource>
        )}
        {hazards.map((h) => {
          const threat = getHazardThreat(h.depth_cm, draftCm);
          const ts = THREAT_STYLE[threat];
          return (
            <Marker
              key={String(h.id)}
              id={String(h.id)}
              lngLat={[h.longitude, h.latitude]}
            >
              <View
                style={[styles.hazardMarker, { backgroundColor: ts.bg }]}
                accessible
                accessibilityLabel={`Matalikko: ${ts.label}${h.depth_cm ? `, ${h.depth_cm} cm` : ''}`}
              >
                <Text style={styles.hazardMarkerText}>{ts.icon}</Text>
              </View>
            </Marker>
          );
        })}
      </Map>

      <View style={styles.topBar}>
        <Text style={styles.appName}>KARIKKO</Text>
        <Text style={styles.draftInfo}>
          {hazardsLoading ? 'Ladataan…' : `Syväys: ${draftCm} cm`}
        </Text>
      </View>

      {location && (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={() => {
            cameraRef.current?.flyTo({
              center: [location.coords.longitude, location.coords.latitude],
              zoom: 13,
              duration: 600,
            });
          }}
          accessibilityLabel="Keskitä kartta omalle sijainnille"
        >
          <Text style={styles.recenterIcon}>◎</Text>
          <Text style={styles.recenterText}>Oma sijaintini</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.rescueButton}
        onPress={() => {
          Alert.alert(
            'Soita meripelastus?',
            'Väärä hätäpuhelu on rangaistava teko. Soita vain todellisessa hädässä.',
            [
              { text: 'Soita 112', style: 'destructive', onPress: () => Linking.openURL('tel:112') },
              { text: 'Peruuta', style: 'cancel' },
            ]
          );
        }}
        accessibilityLabel="Soita meripelastus"
      >
        <Text style={styles.rescueText}>Soita meripelastus</Text>
      </TouchableOpacity>

      <View style={styles.bottomBar}>
        {waterStation && <WaterLevelBar station={waterStation} />}
        {location && (
          <Text style={styles.coordText}>
            {location.coords.latitude.toFixed(4)}°N{' '}
            {location.coords.longitude.toFixed(4)}°E
          </Text>
        )}
        <TouchableOpacity style={styles.reportButton} onPress={handleReportHazard}>
          <Text style={styles.reportButtonText}>⚠ Merkitse matalikko</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={reportModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Merkitse matalikko</Text>
            <Text style={styles.modalSubtitle}>
              Sijainti tallennetaan nykyiseen GPS-pisteeseesi.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Syvyys senttimetreissä (valinnainen)"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              value={reportDepth}
              onChangeText={setReportDepth}
            />
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              placeholder="Lisätietoja (valinnainen)"
              placeholderTextColor={Colors.textMuted}
              multiline
              value={reportNote}
              onChangeText={setReportNote}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setReportModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>Peruuta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSubmit]}
                onPress={submitReport}
              >
                <Text style={styles.modalBtnSubmitText}>Tallenna</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(10,61,107,0.9)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  appName: {
    color: Colors.white,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 2,
  },
  draftInfo: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: 8,
  },
  coordText: {
    color: Colors.white,
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  reportButton: {
    backgroundColor: Colors.danger,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  reportButtonText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
  recenterButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 112 : 96,
    right: 16,
    backgroundColor: 'rgba(10,61,107,0.9)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  recenterIcon: {
    color: Colors.white,
    fontSize: 18,
  },
  recenterText: {
    color: Colors.white,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rescueButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 176 : 160,
    right: 16,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  rescueText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  vesselMarker: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vesselTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 28,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: Colors.primary,
    // valkoinen reunus varjostuksella
    shadowColor: Colors.white,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 4,
  },
  hazardMarker: {
    backgroundColor: Colors.danger,
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  hazardMarkerText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 12,
  },
  modalInputMultiline: {
    height: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: Colors.border,
  },
  modalBtnCancelText: {
    color: Colors.text,
    fontWeight: '600',
  },
  modalBtnSubmit: {
    backgroundColor: Colors.danger,
  },
  modalBtnSubmitText: {
    color: Colors.white,
    fontWeight: '700',
  },
});
