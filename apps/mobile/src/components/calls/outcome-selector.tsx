import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { apiPatch } from "../../services/api";
import { haptic } from "../../lib/haptics";

const OUTCOMES = [
  { value: "sale", label: "Sale", color: "#22c55e" },
  { value: "no_sale", label: "No Sale", color: "#ef4444" },
  { value: "callback", label: "Callback", color: "#35b2ff" },
  { value: "not_home", label: "Not Home", color: "#71717a" },
  { value: "not_interested", label: "Not Interested", color: "#f97316" },
  { value: "already_has_service", label: "Has Service", color: "#8b5cf6" },
];

export function OutcomeSelector({ callId, currentOutcome }: { callId: string; currentOutcome: string | null }) {
  const [outcome, setOutcome] = useState(currentOutcome ?? "pending");

  async function select(value: string) {
    setOutcome(value);
    haptic.selection();
    try {
      await apiPatch(`/api/calls/${callId}/outcome`, { outcome: value });
      haptic.success();
    } catch {
      setOutcome(currentOutcome ?? "pending");
      haptic.error();
      Alert.alert("Error", "Failed to update outcome");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Outcome</Text>
      <View style={styles.pills}>
        {OUTCOMES.map((o) => (
          <TouchableOpacity key={o.value} onPress={() => select(o.value)}
            style={[styles.pill, outcome === o.value && { borderColor: o.color, backgroundColor: `${o.color}15` }]}>
            <Text style={[styles.pillText, outcome === o.value && { color: o.color }]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  label: { color: "#71717a", fontSize: 12, marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { borderWidth: 1, borderColor: "#27272a", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { color: "#71717a", fontSize: 12, fontWeight: "500" },
});
