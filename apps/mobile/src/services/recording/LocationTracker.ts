import { apiPost } from "../api";
import { getCurrentLocation } from "../location";
import {
  nativeBackgroundLocation,
  type NativeLocationPoint,
} from "./NativeBackgroundLocation";

const SAMPLE_INTERVAL_MS = 30_000; // Capture GPS every 30s
const FLUSH_INTERVAL_MS = 60_000;  // Upload to server every 60s
const MAX_BUFFER = 100;            // Safety cap

interface Point {
  elapsedS: number;
  latitude: number;
  longitude: number;
  capturedAt: string;
}

/**
 * Samples GPS location every 30s during a recording session and batches
 * them to the server every 60s. Each point is tagged with elapsed-time
 * from session start so the split pipeline can geotag each conversation
 * by looking up the closest point.
 */
class LocationTracker {
  private sessionId: string | null = null;
  private startedAt: number = 0;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private buffer: Point[] = [];
  private nativeBacklog: NativeLocationPoint[] = [];
  private usingNativeLocation = false;

  start(sessionId: string): void {
    this.sessionId = sessionId;
    this.startedAt = Date.now();
    this.buffer = [];
    this.usingNativeLocation = nativeBackgroundLocation.isAvailable();

    if (this.usingNativeLocation) {
      nativeBackgroundLocation.startSession(sessionId, this.startedAt).catch(() => {
        this.usingNativeLocation = false;
        this.sample().catch(() => {});
        this.sampleTimer = setInterval(() => {
          this.sample().catch(() => {});
        }, SAMPLE_INTERVAL_MS);
      });
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {});
      }, FLUSH_INTERVAL_MS);
      return;
    }

    // Capture an initial point immediately
    this.sample().catch(() => {});

    this.sampleTimer = setInterval(() => {
      this.sample().catch(() => {});
    }, SAMPLE_INTERVAL_MS);

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.sampleTimer) { clearInterval(this.sampleTimer); this.sampleTimer = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    if (this.usingNativeLocation) {
      const points = await nativeBackgroundLocation.stopSession().catch(() => []);
      await this.flushNativePoints(points).catch(() => {});
      this.usingNativeLocation = false;
    }
    // Final flush
    await this.flush().catch(() => {});
    this.sessionId = null;
    this.buffer = [];
  }

  async flushPendingNative(): Promise<void> {
    if (!nativeBackgroundLocation.isAvailable()) return;
    const points = await nativeBackgroundLocation.drainPoints().catch(() => []);
    await this.flushNativePoints(points);
  }

  private async sample(): Promise<void> {
    if (!this.sessionId) return;
    const coords = await getCurrentLocation();
    if (!coords) return;

    const elapsedS = Math.round((Date.now() - this.startedAt) / 1000);
    this.buffer.push({
      elapsedS,
      latitude: coords.latitude,
      longitude: coords.longitude,
      capturedAt: new Date().toISOString(),
    });

    if (this.buffer.length >= MAX_BUFFER) {
      await this.flush().catch(() => {});
    }
  }

  private async flush(): Promise<void> {
    if (this.usingNativeLocation) {
      await this.flushPendingNative();
      return;
    }
    if (!this.sessionId || this.buffer.length === 0) return;
    const points = this.buffer.slice();
    this.buffer = [];
    try {
      await apiPost("/api/sessions/location", { sessionId: this.sessionId, points });
    } catch {
      // Put them back on the buffer for the next flush
      this.buffer = [...points, ...this.buffer].slice(-MAX_BUFFER);
    }
  }

  private async flushNativePoints(points: NativeLocationPoint[]): Promise<void> {
    const allPoints = [...this.nativeBacklog, ...points].filter(
      (p) =>
        p.sessionId &&
        typeof p.latitude === "number" &&
        typeof p.longitude === "number"
    );
    this.nativeBacklog = [];
    if (allPoints.length === 0) return;

    const bySession = new Map<string, NativeLocationPoint[]>();
    for (const point of allPoints) {
      const existing = bySession.get(point.sessionId) ?? [];
      existing.push(point);
      bySession.set(point.sessionId, existing);
    }

    for (const [sessionId, sessionPoints] of bySession) {
      try {
        await apiPost("/api/sessions/location", {
          sessionId,
          points: sessionPoints.map((p) => ({
            elapsedS: p.elapsedS,
            latitude: p.latitude,
            longitude: p.longitude,
            capturedAt: p.capturedAt,
          })),
        });
      } catch {
        this.nativeBacklog = [...sessionPoints, ...this.nativeBacklog].slice(
          -MAX_BUFFER
        );
      }
    }
  }
}

export const locationTracker = new LocationTracker();
