import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/auth/session";
import { ensureUser } from "@/lib/db/users";

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "email and password are required." },
      { status: 400 },
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Deliberately generic: distinguishing "no such user" from "wrong password"
    // tells an attacker which emails are registered.
    return NextResponse.json(
      { error: "SIGNIN_FAILED", message: "Invalid email or password." },
      { status: 401 },
    );
  }

  if (data.user?.email) {
    await ensureUser(data.user.id, data.user.email);
  }
  return NextResponse.json({ userId: data.user?.id ?? null });
}
