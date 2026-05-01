export const CHUNK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const SAMPLE_RATE = 16000;
export const CHANNELS = 1;
export const BIT_RATE = 64000; // 64 kbps

const LOCAL_DEV_API_URL = "http://localhost:3001";
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim();
const IS_DEV_BUILD =
  typeof __DEV__ !== "undefined"
    ? __DEV__
    : process.env.NODE_ENV !== "production";

function isLocalhostUrl(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);
}

function normalizeApiBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildApiBaseUrlStatus() {
  if (RAW_API_URL) {
    const normalized = normalizeApiBaseUrl(RAW_API_URL);
    if (!/^https?:\/\//i.test(normalized)) {
      return {
        value: "",
        valid: false,
        error:
          "EXPO_PUBLIC_API_URL must start with http:// or https://.",
      };
    }
    if (!IS_DEV_BUILD && isLocalhostUrl(normalized)) {
      return {
        value: "",
        valid: false,
        error:
          "EXPO_PUBLIC_API_URL points to localhost in a production build. Set it to the deployed API host.",
      };
    }
    return { value: normalized, valid: true, error: null };
  }

  if (IS_DEV_BUILD) {
    return { value: LOCAL_DEV_API_URL, valid: true, error: null };
  }

  return {
    value: "",
    valid: false,
    error:
      "EXPO_PUBLIC_API_URL is missing. Production mobile builds must point at the deployed API host.",
  };
}

export const API_BASE_URL_STATUS = buildApiBaseUrlStatus();
export const API_BASE_URL = API_BASE_URL_STATUS.value;

export function getApiBaseUrl(): string {
  if (!API_BASE_URL_STATUS.valid) {
    throw new Error(API_BASE_URL_STATUS.error ?? "API base URL is invalid");
  }
  return API_BASE_URL_STATUS.value;
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}
