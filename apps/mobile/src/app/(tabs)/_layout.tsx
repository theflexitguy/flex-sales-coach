import { Tabs, useRouter } from "expo-router";
import { TouchableOpacity, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNotifications } from "../../hooks/useNotifications";

export default function TabLayout() {
  const { unreadCount } = useNotifications();
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#09090b",
          borderTopColor: "#27272a",
        },
        tabBarActiveTintColor: "#35b2ff",
        tabBarInactiveTintColor: "#71717a",
        headerStyle: {
          backgroundColor: "#09090b",
          borderBottomColor: "#27272a",
          borderBottomWidth: 1,
        },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push("/notifications")} style={{ marginRight: 16, position: "relative" }}>
            <Ionicons name="notifications-outline" size={22} color="#a1a1aa" />
            {unreadCount > 0 && (
              <View style={{ position: "absolute", top: -4, right: -6, backgroundColor: "#ef4444", borderRadius: 8, minWidth: 16, height: 16, justifyContent: "center", alignItems: "center" }}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mic" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: "Conversations",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="coaching"
        options={{
          title: "Coaching",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Learn",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="library" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
