import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import polyline from '@mapbox/polyline';
import { getMapHtml } from './DriverMapHtml';

// Johannesburg default center
const DEFAULT_LAT = -26.2041;
const DEFAULT_LNG = 28.0473;

export interface MapMarker {
  id: string;
  type: string; // pickup | dropoff | stop | store
  lat: number;
  lng: number;
}

interface DriverMapProps {
  polyline?: string;
  trimmedPolyline?: string;
  vehiclePosition?: { lat: number; lng: number; heading: number };
  vehicleType?: string;
  markers?: MapMarker[];
  arrivalTime?: string | null;
  arrivalPosition?: { lat: number; lng: number } | null;
  followVehicle?: boolean;
  onMapReady?: () => void;
}

export default function DriverMap({
  polyline: encodedPolyline,
  trimmedPolyline,
  vehiclePosition,
  vehicleType,
  markers,
  arrivalTime,
  arrivalPosition,
  followVehicle,
  onMapReady,
}: DriverMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // Stable HTML so the WebView doesn't reload on every render
  const htmlRef = useRef<string>(getMapHtml(DEFAULT_LAT, DEFAULT_LNG));

  const sendCommand = (obj: object) => {
    const payload = JSON.stringify(obj);
    webViewRef.current?.injectJavaScript(
      `window.postMessage(${JSON.stringify(payload)}, '*'); true;`
    );
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setIsMapReady(true);
        onMapReady?.();
      }
    } catch (e) {
      // ignore malformed messages
    }
  };

  // Draw polyline + fit bounds when polyline changes
  useEffect(() => {
    if (!isMapReady) return;
    if (encodedPolyline) {
      sendCommand({ type: 'DRAW_POLYLINE', encodedPolyline, color: '#5B2EFF' });
      try {
        const decoded = polyline.decode(encodedPolyline); // [[lat, lng], ...]
        const coords = decoded.map((p) => [p[1], p[0]]); // -> [lng, lat]
        sendCommand({ type: 'FIT_BOUNDS', coords });
      } catch (e) {
        // ignore decode errors
      }
    } else {
      sendCommand({ type: 'CLEAR_POLYLINE' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedPolyline, isMapReady]);

  // Update vehicle position + trim polyline
  useEffect(() => {
    if (!isMapReady || !vehiclePosition) return;
    sendCommand({
      type: 'UPDATE_VEHICLE',
      lat: vehiclePosition.lat,
      lng: vehiclePosition.lng,
      heading: vehiclePosition.heading,
      vehicleType: vehicleType || 'economy',
    });
    sendCommand({
      type: 'TRIM_POLYLINE',
      driverLat: vehiclePosition.lat,
      driverLng: vehiclePosition.lng,
    });
    // Pro-app follow camera: keep the map centered tightly on the live vehicle
    // while following. The existing FIT_BOUNDS overview still runs when a route
    // is (re)drawn; this only takes over on subsequent position updates.
    if (followVehicle) {
      sendCommand({
        type: 'FOLLOW_VEHICLE',
        lat: vehiclePosition.lat,
        lng: vehiclePosition.lng,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclePosition, vehicleType, isMapReady, followVehicle]);

  // Update markers
  useEffect(() => {
    if (!isMapReady) return;
    sendCommand({ type: 'SET_MARKERS', markers: markers || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, isMapReady]);

  // Update arrival card
  useEffect(() => {
    if (!isMapReady) return;
    sendCommand({
      type: 'SET_ARRIVAL_CARD',
      arrivalTime: arrivalTime ?? null,
      lat: arrivalPosition?.lat,
      lng: arrivalPosition?.lng,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalTime, arrivalPosition?.lat, arrivalPosition?.lng, isMapReady]);

  // On web, react-native-webview renders an iframe; html source works the same.
  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlRef.current }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        onMessage={handleMessage}
        // Allow remote tile/image loads
        mixedContentMode="always"
        {...(Platform.OS === 'android' ? { androidLayerType: 'hardware' as const } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  webview: {
    flex: 1,
    backgroundColor: '#E8E8E8',
  },
});
