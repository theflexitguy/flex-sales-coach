import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { queryObjectionLibrary, getExamplesForCategory } from "@/lib/queries/objection-library";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createServer();
  const url = new URL(request.url);

  const filters = {
    category: url.searchParams.get("category") ?? undefined,
    grade: url.searchParams.get("grade") ?? undefined,
    repId: url.searchParams.get("repId") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    limit: parseInt(url.searchParams.get("limit") ?? "50", 10),
    offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
  };

  const data = await queryObjectionLibrary(supabase, filters);

  // If requesting examples for a specific category
  const examplesFor = url.searchParams.get("examplesFor");
  let examples = null;
  if (examplesFor) {
    examples = await getExamplesForCategory(supabase, examplesFor);
  }

  return NextResponse.json({ ...data, examples });
}
