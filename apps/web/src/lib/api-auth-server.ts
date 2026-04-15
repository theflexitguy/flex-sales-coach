import { createServer } from "@/lib/supabase-server";
import { authenticateRequest } from "@/lib/api-auth";

/**
 * Authenticate an API request via cookie OR Bearer token.
 * Tries cookie-based auth first (web dashboard), falls back to Bearer token (mobile app).
 */
export async function requireApiAuth(request?: Request) {
  // Try cookie-based auth first (web dashboard)
  try {
    const supabase = await createServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, team_id")
        .eq("id", user.id)
        .single();
      return { user, profile, supabase };
    }
  } catch {
    // Cookie auth failed, try Bearer token
  }

  // Fall back to Bearer token auth (mobile app)
  if (request) {
    const result = await authenticateRequest(request);
    if (result) return result;
  }

  return null;
}

/**
 * Internal API secret for server-to-server calls (transcribe, analyze, split).
 */
export function isInternalCall(request: Request): boolean {
  const secret = request.headers.get("x-internal-secret");
  return secret === (process.env.INTERNAL_API_SECRET || "flex-internal-2024");
}
