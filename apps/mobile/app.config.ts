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
    buildNumber: "22",
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
    [
      "@config-plugins/react-native-webrtc",
      {
        cameraPermission:
          "Flex Sales Coach does not need your camera.",
        microphonePermission:
          "Flex Sales Coach needs microphone access for AI roleplay conversations.",
      },
    ],
    // Patches iOS AppDelegate + Android MainApplication to call
    // LiveKitReactNative.setUp() before React Native init. Without this the
    // @livekit/react-native native bridge isn't initialized and any import
    // of @elevenlabs/react-native crashes the app at launch.
    "@livekit/react-native-expo-plugin",
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
