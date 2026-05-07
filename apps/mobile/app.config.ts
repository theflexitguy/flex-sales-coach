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
      UIBackgroundModes: ["audio", "location"],
      NSMicrophoneUsageDescription:
        "Flex Sales Coach records your sales conversations for AI-powered coaching analysis.",
      NSCameraUsageDescription:
        "Koachr may access the camera through its voice practice connection library, but roleplay practice uses audio only.",
      NSLocationWhenInUseUsageDescription:
        "Koachr uses your location while recording to separate door-to-door conversations and tag where they happened.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Koachr uses background location only during active recordings to separate visits when you walk between homes.",
      NSLocationAlwaysUsageDescription:
        "Koachr uses background location only during active recordings to separate visits when you walk between homes.",
      ITSAppUsesNonExemptEncryption: false,
    },
    buildNumber: "39",
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
      "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-audio",
      {
        microphonePermission:
          "Flex Sales Coach needs microphone access to record sales conversations for coaching.",
        enableBackgroundPlayback: true,
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
    // Native CLLocationManager sampler. JS timers are throttled in the
    // background, but native location updates continue while the app is
    // recording so conversation splitting can use movement between homes.
    "./plugins/with-flex-background-location",
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
