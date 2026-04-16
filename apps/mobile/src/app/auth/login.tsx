import { useState } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signIn = useAuthStore((s) => s.signIn);
  const router = useRouter();

  async function handleLogin() {
    if (!email || !password) return;
    setError(null);
    setLoading(true);

    const err = await signIn(email, password);
    if (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <View style={styles.dot} />
            <Text style={styles.badgeText}>KOACHR</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#71717a"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor="#71717a"
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Signing in..." : "Sign in"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/auth/signup")} style={{ marginTop: 16, alignItems: "center" }}>
            <Text style={{ color: "#a1a1aa", fontSize: 14 }}>
              Have an invite code?{" "}
              <Text style={{ color: "#35b2ff", fontWeight: "600" }}>Join your team</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#35b2ff",
  },
  badgeText: {
    color: "#35b2ff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 4,
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: 15,
  },
  errorBox: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "#f87171",
    fontSize: 14,
  },
  form: {
    gap: 4,
  },
  label: {
    color: "#d4d4d8",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(39,39,42,0.5)",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#35b2ff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
