import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../stores/auth-store";

export default function ProfileScreen() {
  const { profile, signOut } = useAuthStore();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.fullName?.charAt(0)?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.fullName ?? "Unknown"}</Text>
        <Text style={styles.email}>{profile?.email ?? ""}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>
            {profile?.role === "manager" ? "Manager" : "Sales Rep"}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Ionicons name="business-outline" size={20} color="#71717a" />
          <Text style={styles.infoLabel}>Team</Text>
          <Text style={styles.infoValue}>Flex Sales Team</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => router.push("/diagnostics")}
      >
        <Ionicons name="pulse-outline" size={20} color="#35b2ff" />
        <Text style={styles.linkRowText}>Diagnostics</Text>
        <Ionicons name="chevron-forward" size={18} color="#52525b" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Ionicons name="log-out-outline" size={20} color="#f87171" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>koachr v1.0.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
    padding: 16,
  },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 20,
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#27272a",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarText: {
    color: "#d4d4d8",
    fontSize: 24,
    fontWeight: "600",
  },
  name: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  email: {
    color: "#71717a",
    fontSize: 14,
    marginBottom: 12,
  },
  roleBadge: {
    backgroundColor: "rgba(53,178,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  roleText: {
    color: "#35b2ff",
    fontSize: 13,
    fontWeight: "600",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
  },
  infoLabel: {
    color: "#71717a",
    fontSize: 14,
    flex: 1,
  },
  infoValue: {
    color: "#d4d4d8",
    fontSize: 14,
    fontWeight: "500",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 16,
    marginBottom: 12,
  },
  linkRowText: {
    flex: 1,
    color: "#d4d4d8",
    fontSize: 15,
    fontWeight: "500",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  signOutText: {
    color: "#f87171",
    fontSize: 15,
    fontWeight: "500",
  },
  version: {
    color: "#3f3f46",
    fontSize: 12,
    textAlign: "center",
    marginTop: 20,
  },
});
