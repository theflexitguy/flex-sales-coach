import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useAuthStore } from "../../stores/auth-store";
import { ObjectionLibrary } from "../../components/learn/objection-library";
import { ScenarioBrowser } from "../../components/learn/scenario-browser";
import { RoleplayHistory } from "../../components/learn/roleplay-history";

type Tab = "roleplay" | "objections" | "history";

export default function LearnScreen() {
  const profile = useAuthStore((s) => s.profile);
  const isManager = profile?.role === "manager";
  const canUseRoleplay = isManager || profile?.roleplayBetaEnabled === true;

  const [activeTab, setActiveTab] = useState<Tab>("objections");

  // Tabs available to all users vs roleplay beta testers.
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(canUseRoleplay ? [{ key: "roleplay" as const, label: "Practice" }] : []),
    { key: "objections", label: "Objections" },
    ...(canUseRoleplay ? [{ key: "history" as const, label: "History" }] : []),
  ];

  return (
    <View style={styles.container}>
      {/* Segmented control */}
      <View style={styles.segmentedControl}>
        {tabs.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.segment, activeTab === key && styles.segmentActive]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={[styles.segmentText, activeTab === key && styles.segmentTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {activeTab === "roleplay" && canUseRoleplay && <ScenarioBrowser />}
        {activeTab === "objections" && <ObjectionLibrary />}
        {activeTab === "history" && canUseRoleplay && <RoleplayHistory />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  segmentedControl: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: "#18181b",
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: "#27272a",
  },
  segmentText: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "600",
  },
  segmentTextActive: {
    color: "#fff",
  },
});
