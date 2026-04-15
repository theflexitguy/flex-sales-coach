"use server";

import { redirect } from "next/navigation";
import { createServer } from "@/lib/supabase-server";

export async function signOut() {
  const supabase = await createServer();
  await supabase.auth.signOut();
  redirect("/login");
}
