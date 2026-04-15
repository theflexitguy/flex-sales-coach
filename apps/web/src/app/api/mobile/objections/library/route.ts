import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { queryObjectionLibrary, getExamplesForCategory } from "@/lib/queries/objection-library";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const filters = {
    category: url.searchParams.get("category") ?? undefined,
    grade: url.searchParams.get("grade") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    limit: parseInt(url.searchParams.get("limit") ?? "30", 10),
    offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
  };

  const data = await queryObjectionLibrary(auth.supabase, filters);

  const examplesFor = url.searchParams.get("examplesFor");
  let examples = null;
  if (examplesFor) {
    examples = await getExamplesForCategory(auth.supabase, examplesFor);
  }

  return NextResponse.json({ ...data, examples });
}
