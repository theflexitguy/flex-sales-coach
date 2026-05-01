import { useEffect, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppState, View, ActivityIndicator } from "react-native";
import type { AppStateStatus } from "react-native";
import { useAuthStore } from "../stores/auth-store";
import { uploadQueue } from "../services/recording/UploadQueue";
import { chunkManager } from "../services/recording/ChunkManager";
import { locationTracker } from "../services/recording/LocationTracker";
import { useRecordingStore } from "../stores/recording-store";
import { UploadProgressBanner } from "../components/upload-progress-banner";

export default function RootLayout() {
  const { session, loading, initialize } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    initialize().then(() => setReady(true)).catch(() => setReady(true));
    chunkManager
      .drainNativeFinalizedChunks()
      .finally(() => locationTracker.flushPendingNative())
      .finally(() => uploadQueue.restore());
  }, []);

  // After auth is ready, recover any orphaned recording sessions from a crash/kill
  useEffect(() => {
    if (ready && session) {
      useRecordingStore.getState().recoverOrphanedSessions().catch(() => {});
    }
  }, [ready, session]);

  // Handle app background/foreground transitions
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        // Coming back to foreground — sync elapsed time and retry uploads
        const { isRecording, startedAt } = useRecordingStore.getState();
        if (isRecording && startedAt) {
          useRecordingStore.setState({ elapsedMs: Date.now() - startedAt.getTime() });
        }
        chunkManager
          .drainNativeFinalizedChunks()
          .finally(() => locationTracker.flushPendingNative())
          .finally(() => uploadQueue.restore());
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
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
      {session && <UploadProgressBanner />}
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
        <Stack.Screen
          name="diagnostics"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: "#09090b" },
            headerTintColor: "#fff",
            title: "Diagnostics",
            presentation: "modal",
          }}
        />
      </Stack>
    </>
  );
}
