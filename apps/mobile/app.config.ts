import type { ExpoConfig } from "expo/config";

const IS_DEV = process.env.APP_VARIANT === "development";

const config: ExpoConfig = {
  name: IS_DEV ? "koachr (dev)" : "koachr",
  slug: "flex-sales-coach",
  version: "1.0.0",
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  scheme: "flex-sales-coach",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#09090b",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV
      ? "com.flexpestcontrol.salescoach.dev"
      : "com.flexpestcontrol.salescoach",
    infoPlist: {
      UIBackgroundModes: ["audio"],
      NSMicrophoneUsageDescription:
        "Flex Sales Coach records your sales conversations for AI-powered coaching analysis.",
      NSLocationWhenInUseUsageDescription:
        "Flex Sales Coach uses your location to tag where each sales conversation happens.",
      ITSAppUsesNonExemptEncryption: false,
    },
    buildNumber: "26",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#09090b",
    },
    package: IS_DEV
      ? "com.flexpestcontrol.salescoach.dev"
      : "com.flexpestcontrol.salescoach",
    permissions: [
      "RECORD_AUDIO",
      "FOREGROUND_SERVICE",
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-audio",
      {
        microphonePermission:
          "Flex Sales Coach needs microphone access to record sales conversations for coaching.",
      },
    ],
    // Native AVAudioSession interruption observer. Fires on phone calls,
    // Siri, BT route changes, etc. and re-activates the session in
    // native code — the JS watchdog can't do this while backgrounded
    // because iOS throttles setInterval.
    "./plugins/with-flex-recording-monitor",
    // Native URLSession.background uploader. Uploads continue even
    // when the app is suspended or killed. Without this, JS-driven
    // uploads freeze when iOS suspends the app after backgrounding.
    "./plugins/with-flex-background-uploader",
    // Native AVAudioRecorder + DispatchSourceTimer chunk rotator.
    // Native timers fire reliably when the app is deep-backgrounded;
    // JS setInterval gets throttled hard. Prevents multi-hour sessions
    // from producing one giant chunk or losing chunks entirely.
    "./plugins/with-flex-chunk-recorder",
  ],
  extra: {
    router: {},
    eas: {
      projectId: "a36d716e-af44-45ca-9543-30d81dcd449a",
    },
  },
  owner: "theflexitguy",
};

export default config;
