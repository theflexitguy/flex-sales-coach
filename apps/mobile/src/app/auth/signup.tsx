import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { haptic } from "../../lib/haptics";

export default function SignupScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSignup() {
    if (!fullName || !email || !password || !inviteCode.trim()) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          fullName,
          inviteCode: inviteCode.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Signup failed");
        setLoading(false);
        haptic.error();
        return;
      }

      haptic.success();
      Alert.alert("Account Created", "You can now sign in with your email and password.");
      router.replace("/auth/login");
    } catch {
      setError("Network error. Please try again.");
      haptic.error();
    }

    setLoading(false);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <View style={styles.badge}><View style={styles.dot} /><Text style={styles.badgeText}>KOACHR</Text></View>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join your team</Text>
        </View>

        {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

        <View style={styles.form}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Your name" placeholderTextColor="#71717a" autoCapitalize="words" />

          <Text style={[styles.label, { marginTop: 12 }]}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#71717a" autoCapitalize="none" keyboardType="email-address" />

          <Text style={[styles.label, { marginTop: 12 }]}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="At least 8 characters" placeholderTextColor="#71717a" secureTextEntry />

          <Text style={[styles.label, { marginTop: 12 }]}>Team Invite Code</Text>
          <TextInput style={styles.input} value={inviteCode} onChangeText={setInviteCode} placeholder="Required — get this from your manager" placeholderTextColor="#71717a" autoCapitalize="characters" />

          <TouchableOpacity style={[styles.button, loading && { opacity: 0.5 }]} onPress={handleSignup} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? "Creating..." : "Create Account"}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace("/auth/login")} style={{ marginTop: 16, alignItems: "center" }}>
            <Text style={styles.linkText}>Already have an account? <Text style={{ color: "#35b2ff", fontWeight: "600" }}>Sign in</Text></Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b", justifyContent: "center", paddingHorizontal: 24 },
  inner: { maxWidth: 400, width: "100%", alignSelf: "center" },
  header: { alignItems: "center", marginBottom: 24 },
  badge: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#35b2ff" },
  badgeText: { color: "#35b2ff", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 4 },
  subtitle: { color: "#a1a1aa", fontSize: 15 },
  errorBox: { backgroundColor: "rgba(239,68,68,0.1)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)", borderRadius: 12, padding: 12, marginBottom: 16 },
  errorText: { color: "#f87171", fontSize: 14 },
  form: {},
  label: { color: "#d4d4d8", fontSize: 14, fontWeight: "500", marginBottom: 6 },
  input: { backgroundColor: "rgba(39,39,42,0.5)", borderWidth: 1, borderColor: "#3f3f46", borderRadius: 12, padding: 14, color: "#fff", fontSize: 16 },
  button: { backgroundColor: "#35b2ff", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  linkText: { color: "#a1a1aa", fontSize: 14 },
});
