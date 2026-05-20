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
  Vibration,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
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
import { insertHazard, getNearbyHazards } from '../storage/db';
import WaterLevelBar, { WaterStation } from '../components/WaterLevelBar';

const API_BASE = 'https://karikko-api.vercel.app/api/v1';

type HazardThreat = 'danger' | 'caution' | 'safe';

interface Vessel {
  mmsi: number;
  name: string | null;
  ship_type: string;
  lat: number;
  lon: number;
  sog_kn: number;
  cog_deg: number;
  heading_deg: number | null;
  nav_status: number;
}

interface ApiHazard {
  id: number;
  latitude: number;
  longitude: number;
  depth_cm: number | null;
  note: string | null;
  photo_url: string | null;
  confirmed_count: number;
  status: string;
  reported_at: string | null;
}

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

const WIND_DIRS = ['Pohjoinen', 'Koillinen', 'Itä', 'Kaakko', 'Etelä', 'Lounas', 'Länsi', 'Luode'];
function degToCardinal(deg: number): string {
  return WIND_DIRS[Math.round(deg / 45) % 8];
}

const NAV_STATUS: Record<number, string> = {
  0: 'Matkalla', 1: 'Ankkurissa', 2: 'Ei hallinnassa',
  3: 'Rajoitettu ohjauskyky', 4: 'Syväysrajoitus', 5: 'Laiturissa',
  6: 'Maalle ajanut', 7: 'Kalastamassa', 8: 'Purjehtimassa',
};

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

  useEffect(() => {
    fetch(`${API_BASE}/notices`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data?.notices) setNoticeCount(d.data.notices.length); })
      .catch(() => {});
  }, []);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [draftCm, setDraftCm] = useState<number>(80);
  const [hazards, setHazards] = useState<ApiHazard[]>([]);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reportDepth, setReportDepth] = useState('');
  const [reportPhotoUri, setReportPhotoUri] = useState<string | null>(null);
  const [selectedHazard, setSelectedHazard] = useState<ApiHazard | null>(null);
  const [hazardPhotoLoading, setHazardPhotoLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [waterStation, setWaterStation] = useState<WaterStation | null>(null);
  const [fairwayLines, setFairwayLines] = useState<any>(null);
  const [shallowAreas, setShallowAreas] = useState<any>(null);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const [noticeCount, setNoticeCount] = useState<number>(0);
  const [lightningCount, setLightningCount] = useState<number>(0);
  const [wind, setWind] = useState<{ speedMs: number; dirDeg: number; gustMs: number } | null>(null);
  const [hazardsLoading, setHazardsLoading] = useState(false);
  const cameraRef = useRef<CameraRef>(null);
  const hasFollowed = useRef(false);
  const locationRef = useRef<Location.LocationObject | null>(null);
  const forecastFetched = useRef(false);
  const FINLAND_DEFAULT = { center: [25.0, 60.2] as [number, number], zoom: 7 };

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let vesselInterval: ReturnType<typeof setInterval> | null = null;

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
          locationRef.current = loc;
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
          fetchVessels(loc.coords.latitude, loc.coords.longitude);
          fetchLightning(loc.coords.latitude, loc.coords.longitude);
          if (!forecastFetched.current) {
            forecastFetched.current = true;
            fetchMarineForecast(loc.coords.latitude, loc.coords.longitude);
          }
        }
      );

      vesselInterval = setInterval(() => {
        const loc = locationRef.current;
        if (loc) {
          fetchVessels(loc.coords.latitude, loc.coords.longitude);
          fetchLightning(loc.coords.latitude, loc.coords.longitude);
        }
      }, 30_000);
    })();

    return () => {
      sub?.remove();
      if (vesselInterval) clearInterval(vesselInterval);
    };
  }, []);

  async function fetchHazards(lat: number, lon: number) {
    setHazardsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/hazards?lat=${lat}&lon=${lon}`);
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
    setHazards(local.map((h) => ({
      id: h.id ?? 0,
      latitude: h.latitude,
      longitude: h.longitude,
      depth_cm: h.depth_cm ?? null,
      note: h.note ?? null,
      photo_url: null,
      confirmed_count: 0,
      status: 'unverified',
      reported_at: null,
    })));
  }

  async function fetchFairways(lat: number, lon: number) {
    try {
      const res = await fetch(`${API_BASE}/fairways?lat=${lat}&lon=${lon}&radius_m=5000`);
      if (!res.ok) return;
      const json = await res.json();
      const payload = json.data ?? json;
      const lines = payload.lines ?? [];
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

      const shallowFeatures = (payload.fairways ?? [])
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
      const res = await fetch(`${API_BASE}/water-level?lat=${lat}&lon=${lon}`);
      if (!res.ok) return;
      const data = await res.json();
      const first = data.stations?.[0];
      if (first && first.distKm <= 25) setWaterStation(first);
    } catch {
      // offline tai verkkovirhe — näytetään vanha arvo jos on
    }
  }

  async function fetchVessels(lat: number, lon: number) {
    try {
      const res = await fetch(`${API_BASE}/vessels?lat=${lat}&lon=${lon}&radius_m=10000`);
      if (!res.ok) return;
      const data = await res.json();
      setVessels(data.data?.vessels ?? []);
    } catch {
      // offline — säilytetään vanha data
    }
  }

  async function fetchLightning(lat: number, lon: number) {
    try {
      const res = await fetch(`${API_BASE}/lightning?lat=${lat}&lon=${lon}&radius_m=50000&minutes=30`);
      if (!res.ok) return;
      const data = await res.json();
      const groundStrikes = (data.data?.strikes ?? []).filter((s: { cloud_flash: boolean }) => !s.cloud_flash);
      setLightningCount(groundStrikes.length);
    } catch {
      // offline
    }
  }

  async function fetchMarineForecast(lat: number, lon: number) {
    try {
      const res = await fetch(`${API_BASE}/marine-forecast?lat=${lat}&lon=${lon}`);
      if (!res.ok) return;
      const data = await res.json();
      const now = data.data?.hours?.[0];
      if (now && now.wind_speed_ms !== null) {
        setWind({ speedMs: now.wind_speed_ms, dirDeg: now.wind_direction_deg ?? 0, gustMs: now.wind_gust_ms ?? now.wind_speed_ms });
      }
    } catch {
      // offline
    }
  }

  async function pickPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Kameralupa puuttuu', 'Salli kameran käyttö asetuksista lisätäksesi kuvan.');
      return;
    }
    Alert.alert(
      'Lisää kuva',
      'Valitse lähde',
      [
        {
          text: 'Ota kuva',
          onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 0.8,
              allowsEditing: false,
            });
            if (!result.canceled && result.assets[0]) {
              await processAndSetPhoto(result.assets[0].uri);
            }
          },
        },
        {
          text: 'Valitse galleriasta',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.8,
              allowsEditing: false,
            });
            if (!result.canceled && result.assets[0]) {
              await processAndSetPhoto(result.assets[0].uri);
            }
          },
        },
        { text: 'Peruuta', style: 'cancel' },
      ],
    );
  }

  async function processAndSetPhoto(uri: string) {
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
    ctx.resize({ width: 1000 });
    const resized = await ctx.renderAsync();
    const saved = await resized.saveAsync({ compress: 0.75, format: ImageManipulator.SaveFormat.JPEG });
    setReportPhotoUri(saved.uri);
  }

  async function handleReportHazard() {
    if (!location) {
      Alert.alert('Sijainti ei saatavilla', 'Odota että GPS löytyy.');
      return;
    }
    Vibration.vibrate(50);
    setReportModalVisible(true);
  }

  async function submitReport() {
    if (!location) return;
    const depth = reportDepth ? parseInt(reportDepth, 10) : undefined;

    setReportModalVisible(false);

    // Tallennetaan paikallisesti heti (offline-tuki)
    await insertHazard({ latitude: location.coords.latitude, longitude: location.coords.longitude, depth_cm: depth, note: reportNote || undefined });

    // Ladataan kuva jos on, muuten lähetetään ilman
    let photoUrl: string | null = null;
    if (reportPhotoUri) {
      try {
        const form = new FormData();
        form.append('photo', { uri: reportPhotoUri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
        const uploadRes = await fetch(`${API_BASE}/hazards/photo`, {
          method: 'POST',
          headers: { 'X-App-Platform': 'karikko-mobile' },
          body: form,
        });
        if (uploadRes.ok) {
          const { url } = await uploadRes.json() as { url: string };
          photoUrl = url;
        }
      } catch {
        // kuvan lataus epäonnistui — jatketaan ilman kuvaa
      }
    }

    setReportNote('');
    setReportDepth('');
    setReportPhotoUri(null);

    fetch(`${API_BASE}/hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Platform': 'karikko-mobile' },
      body: JSON.stringify({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        depth_cm: depth ?? null,
        note: reportNote || null,
        photo_url: photoUrl,
      }),
    }).catch(() => {});

    Alert.alert('Kiitos!', 'Matalikkomerkintä tallennettu.');
    fetchHazards(location.coords.latitude, location.coords.longitude);
  }

  async function confirmHazard(hazard: ApiHazard) {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/hazards/${hazard.id}/confirm`, {
        method: 'POST',
        headers: { 'X-App-Platform': 'karikko-mobile' },
      });
      if (res.ok) {
        setSelectedHazard({ ...hazard, confirmed_count: hazard.confirmed_count + 1 });
        setHazards((prev) =>
          prev.map((h) => h.id === hazard.id ? { ...h, confirmed_count: h.confirmed_count + 1 } : h)
        );
      }
    } catch {
      // offline — ei tehdä mitään
    } finally {
      setConfirming(false);
    }
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
        {vessels.map((v) => {
          const isMoving = v.sog_kn >= 0.5;
          const rotation = v.heading_deg ?? v.cog_deg;
          const label = v.name
            ? `${v.name}, ${v.ship_type}, ${v.sog_kn.toFixed(1)} solmua`
            : `${v.ship_type}, ${v.sog_kn.toFixed(1)} solmua`;
          return (
            <Marker
              key={String(v.mmsi)}
              id={`vessel-${v.mmsi}`}
              lngLat={[v.lon, v.lat]}
            >
              <TouchableOpacity
                accessible
                accessibilityLabel={label}
                accessibilityRole="button"
                onPress={() => setSelectedVessel(v)}
                style={[
                  styles.vesselOtherMarker,
                  isMoving && { transform: [{ rotate: `${rotation}deg` }] },
                ]}
              >
                {isMoving
                  ? <View style={styles.vesselOtherTriangle} />
                  : <View style={styles.vesselOtherAnchor} />}
              </TouchableOpacity>
            </Marker>
          );
        })}
        {hazards.map((h) => {
          const threat = getHazardThreat(h.depth_cm, draftCm);
          const ts = THREAT_STYLE[threat];
          return (
            <Marker
              key={String(h.id)}
              id={String(h.id)}
              lngLat={[h.longitude, h.latitude]}
            >
              <TouchableOpacity
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Matalikko: ${ts.label}${h.depth_cm ? `, ${h.depth_cm} cm` : ''}`}
                onPress={() => setSelectedHazard(h)}
                style={[styles.hazardMarker, { backgroundColor: ts.bg }]}
              >
                <Text style={styles.hazardMarkerText}>{ts.icon}</Text>
              </TouchableOpacity>
            </Marker>
          );
        })}
      </Map>

      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Text style={styles.appName}>KARIKKO</Text>
          {noticeCount > 0 && (
            <View
              style={styles.noticeBadge}
              accessible
              accessibilityLabel={`${noticeCount} merenkulkutiedotetta`}
            >
              <Text style={styles.noticeBadgeText}>{noticeCount}</Text>
            </View>
          )}
          {lightningCount > 0 && (
            <View
              style={styles.lightningBadge}
              accessible
              accessibilityLabel={`Salamavaroitus: ${lightningCount} maasalamaiskua 50 km säteellä`}
            >
              <Text style={styles.lightningBadgeText}>⚡ {lightningCount}</Text>
            </View>
          )}
        </View>
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
          Vibration.vibrate(50);
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

      {selectedHazard && (
        <View style={styles.vesselCard}>
          <View style={styles.vesselCardHeader}>
            <Text style={styles.vesselCardName}>
              {selectedHazard.note ?? 'Matalikko'}
            </Text>
            <TouchableOpacity onPress={() => setSelectedHazard(null)} accessibilityLabel="Sulje matalikkokortti" hitSlop={12}>
              <Text style={styles.vesselCardClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.vesselCardType}>
            {THREAT_STYLE[getHazardThreat(selectedHazard.depth_cm, draftCm)].label}
            {selectedHazard.depth_cm != null ? ` · ${selectedHazard.depth_cm} cm` : ''}
          </Text>
          {selectedHazard.photo_url && (
            <View style={styles.hazardPhotoWrapper}>
              {hazardPhotoLoading && (
                <ActivityIndicator
                  style={StyleSheet.absoluteFill}
                  color={Colors.white}
                />
              )}
              <Image
                source={{ uri: selectedHazard.photo_url }}
                style={styles.hazardPhoto}
                resizeMode="cover"
                onLoadStart={() => setHazardPhotoLoading(true)}
                onLoadEnd={() => setHazardPhotoLoading(false)}
                accessible
                accessibilityLabel={
                  `Käyttäjän ottama kuva matalikosta` +
                  (selectedHazard.depth_cm != null ? `, syvyys noin ${selectedHazard.depth_cm} senttimetriä` : '')
                }
              />
            </View>
          )}
          <View style={styles.hazardConfirmRow}>
            <Text style={styles.vesselCardStat}>
              {selectedHazard.confirmed_count > 0
                ? `${selectedHazard.confirmed_count} vahvist${selectedHazard.confirmed_count === 1 ? 'us' : 'usta'}`
                : 'Ei vielä vahvistettu'}
            </Text>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={() => confirmHazard(selectedHazard)}
              disabled={confirming}
              accessibilityLabel="Vahvista matalikko — olen nähnyt tämän"
              accessibilityRole="button"
            >
              <Text style={styles.confirmButtonText}>
                {confirming ? '…' : '👍 Vahvistan'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {selectedVessel && (
        <TouchableOpacity
          style={styles.vesselCard}
          onPress={() => setSelectedVessel(null)}
          accessibilityLabel="Sulje alustiedot"
          activeOpacity={1}
        >
          <View style={styles.vesselCardHeader}>
            <Text style={styles.vesselCardName}>
              {selectedVessel.name ?? 'Tuntematon alus'}
            </Text>
            <Text style={styles.vesselCardClose}>✕</Text>
          </View>
          <Text style={styles.vesselCardType}>{selectedVessel.ship_type}</Text>
          <View style={styles.vesselCardRow}>
            <Text style={styles.vesselCardStat}>
              {NAV_STATUS[selectedVessel.nav_status] ?? 'Tuntematon tila'}
            </Text>
            <Text style={styles.vesselCardStat}>
              {selectedVessel.sog_kn.toFixed(1)} kn
            </Text>
            <Text style={styles.vesselCardStat}>
              {degToCardinal(selectedVessel.heading_deg ?? selectedVessel.cog_deg)}
            </Text>
            <Text style={styles.vesselCardMmsi}>
              MMSI {selectedVessel.mmsi}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      <View style={styles.bottomBar}>
        {wind && (
          <Text
            style={styles.windText}
            accessible
            accessibilityLabel={`Tuuli: ${degToCardinal(wind.dirDeg)}, ${wind.speedMs} metriä sekunnissa${wind.gustMs > wind.speedMs ? `, puuska ${wind.gustMs}` : ''}`}
          >
            {'💨 '}
            {degToCardinal(wind.dirDeg)}
            {' '}
            {wind.speedMs} m/s
            {wind.gustMs > wind.speedMs ? ` (puuska ${wind.gustMs})` : ''}
          </Text>
        )}
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
            {reportPhotoUri ? (
              <TouchableOpacity onPress={pickPhoto} style={{ width: '100%', marginBottom: 4 }}>
                <Image source={{ uri: reportPhotoUri }} style={styles.photoPreview} resizeMode="cover" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.photoButton} onPress={pickPhoto}>
                <Text style={styles.photoButtonText}>📷  Lisää kuva (valinnainen)</Text>
              </TouchableOpacity>
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => { setReportModalVisible(false); setReportPhotoUri(null); }}
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
    backgroundColor: '#003354',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#00223A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  appName: {
    color: Colors.white,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 2,
  },
  draftInfo: {
    color: '#FFCC00',
    fontSize: 13,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#003354',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  vesselCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.OS === 'ios' ? 210 : 190,
    backgroundColor: '#003354',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 14,
  },
  vesselCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  vesselCardName: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
  },
  vesselCardClose: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    paddingLeft: 8,
  },
  vesselCardType: {
    color: '#FFCC00',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  vesselCardRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  vesselCardStat: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
  },
  vesselCardMmsi: {
    color: '#a0b2c6',
    fontSize: 11,
    marginLeft: 'auto',
  },
  coordText: {
    color: Colors.white,
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.5,
  },
  reportButton: {
    backgroundColor: Colors.danger,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
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
    backgroundColor: '#003354',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
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
    backgroundColor: Colors.danger,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
    borderWidth: 2,
    borderColor: Colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  rescueText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeBadge: {
    backgroundColor: '#FFCC00',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  noticeBadgeText: {
    color: '#003354',
    fontSize: 11,
    fontWeight: '800',
  },
  lightningBadge: {
    backgroundColor: '#FF8C00',
    borderRadius: 10,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  lightningBadgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '800',
  },
  windText: {
    color: Colors.white,
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.3,
    width: '100%',
    textAlign: 'center',
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
    shadowColor: Colors.white,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 4,
  },
  vesselOtherMarker: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vesselOtherTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 20,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#0066CC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
  },
  vesselOtherAnchor: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0066CC',
    borderWidth: 2,
    borderColor: Colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
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
  photoButton: {
    width: '100%',
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  photoPreview: {
    width: '100%',
    height: 80,
    borderRadius: 10,
  },
  photoButtonText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  hazardPhotoWrapper: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  hazardPhoto: {
    width: '100%',
    height: '100%',
  },
  hazardConfirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  confirmButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  confirmButtonText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
});
