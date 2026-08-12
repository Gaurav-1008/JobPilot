import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/auth/session";
import { ensureUser } from "@/lib/db/users";

/**
 * Sign up (P1.1.2). Credentials are handled entirely by GoTrue — this app never
 * sees or stores a password.
 */
export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "email and password are required." },
      { status: 400 },
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return NextResponse.json({ error: "SIGNUP_FAILED", message: error.message }, { status: 400 });
  }

  // Mirror the GoTrue identity into public.users immediately, so the very first
  // request after signup already has a domain row to scope against.
  if (data.user?.email) {
    await ensureUser(data.user.id, data.user.email);
  }

  return NextResponse.json({ userId: data.user?.id ?? null });
}
