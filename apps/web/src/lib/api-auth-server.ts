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
        .select("id, full_name, email, role, playbook_role, team_id")
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
 * Missing env var is a hard failure — a predictable fallback would let any
 * anonymous caller who knows the string trigger /split, /recover, etc.
 */
export function getInternalSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "INTERNAL_API_SECRET is missing or too short. Set a 32+ char random value in Vercel env."
    );
  }
  return secret;
}

export function isInternalCall(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || expected.length < 16) return false;
  const got = request.headers.get("x-internal-secret");
  return got === expected;
}
