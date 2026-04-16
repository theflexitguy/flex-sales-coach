import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { useAuthStore } from "../stores/auth-store";
import { uploadQueue } from "../services/recording/UploadQueue";

export default function RootLayout() {
  const { session, loading, initialize } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initialize().then(() => setReady(true)).catch(() => setReady(true));
    uploadQueue.restore();
  }, []);

  useEffect(() => {
    if (!ready) return;

    const inAuthGroup = segments[0] === "auth";

    if (!session && !inAuthGroup) {
      router.replace("/auth/login");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, ready, segments]);

  if (!ready || loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#09090b" }}>
        <ActivityIndicator size="large" color="#35b2ff" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#09090b" } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth" />
        <Stack.Screen
          name="notifications"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: "#09090b" },
            headerTintColor: "#fff",
            title: "Notifications",
            presentation: "modal",
          }}
        />
      </Stack>
    </>
  );
}
