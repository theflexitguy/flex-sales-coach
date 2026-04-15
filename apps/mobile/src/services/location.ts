import * as Location from "expo-location";

export interface Coords {
  latitude: number;
  longitude: number;
}

let permissionGranted: boolean | null = null;

/** Request location permission (call once early, e.g., on session start). */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  permissionGranted = status === "granted";
  return permissionGranted;
}

/** Get current GPS coordinates, or null if unavailable. */
export async function getCurrentLocation(): Promise<Coords | null> {
  if (permissionGranted === null) {
    await requestLocationPermission();
  }
  if (!permissionGranted) return null;

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  } catch {
    return null;
  }
}

/** Reverse-geocode coordinates to a street address string. */
export async function reverseGeocode(coords: Coords): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results.length === 0) return null;
    const a = results[0];
    const parts = [a.streetNumber, a.street].filter(Boolean);
    if (a.city) parts.push(a.city);
    if (a.region) parts.push(a.region);
    return parts.join(", ") || null;
  } catch {
    return null;
  }
}
