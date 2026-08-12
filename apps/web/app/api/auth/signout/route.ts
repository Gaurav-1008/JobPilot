import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/auth/session";

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  // EC-P1-01: the client MUST clear its TanStack Query cache on sign-out.
  // The server is correct here, but a stale cache would still render the
  // previous user's resumes and runs in the browser.
  return NextResponse.json({ ok: true });
}
