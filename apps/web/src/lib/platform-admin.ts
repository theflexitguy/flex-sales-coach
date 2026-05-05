import { requireApiAuth } from "@/lib/api-auth-server";

function platformAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().has(email.trim().toLowerCase());
}

export async function requirePlatformAdmin(request?: Request) {
  const auth = await requireApiAuth(request);
  if (!auth?.user?.email || !isPlatformAdminEmail(auth.user.email)) {
    return null;
  }
  return auth;
}
