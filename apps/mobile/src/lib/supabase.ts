import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase config. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
  );
}

// Supabase auth tokens (JWT access + refresh) exceed SecureStore's 2KB limit.
// AsyncStorage is the standard pattern for Supabase on Expo — JWTs are meant
// to be used in plain headers and are protected by short TTLs + refresh rotation.
const storage = {
  getItem: async (key: string) => {
    if (Platform.OS === "web") return localStorage.getItem(key);
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    // Explicitly pass React Native's native fetch. In production bundles
    // (Hermes + minified JS), supabase-js's fetch auto-detection can
    // pick up a broken polyfill that works in dev (via Metro) but not prod.
    fetch: (input, init) => fetch(input as RequestInfo, init),
  },
});
