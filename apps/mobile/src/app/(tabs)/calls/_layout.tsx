import { Stack } from "expo-router";

export default function CallsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#09090b" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#09090b" },
        headerBackTitle: "Conversations",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Conversations" }} />
      <Stack.Screen name="[id]" options={{ title: "Conversation" }} />
    </Stack>
  );
}
