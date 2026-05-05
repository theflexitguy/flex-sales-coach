export const ROLE_TRACKS = [
  { value: "door_to_door_sales", label: "Door-to-door sales" },
  { value: "service_technician", label: "Service technician" },
  { value: "commercial_sales", label: "Commercial sales" },
  { value: "phone_sales", label: "Phone sales" },
] as const;

const ROLE_TRACK_VALUES = new Set(ROLE_TRACKS.map((role) => role.value));

export type RoleTrack = (typeof ROLE_TRACKS)[number]["value"];

export function normalizeRoleTrack(value: unknown): RoleTrack {
  return ROLE_TRACK_VALUES.has(value as RoleTrack)
    ? (value as RoleTrack)
    : "door_to_door_sales";
}

export function roleTrackLabel(value: string | null | undefined): string {
  return ROLE_TRACKS.find((role) => role.value === value)?.label ?? "Door-to-door sales";
}
