/**
 * Google OAuth for the sending account (P5.5.3, architecture.md §14.4).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS REPLACES `token.json`. IT DOES NOT MIGRATE IT.
 *
 * The Closer stored one Google refresh token as a plaintext file on disk,
 * because it was a single-user CLI. That file is not imported here and there is
 * deliberately no code path that reads it: it is one user's long-lived
 * credential in the clear, and a multi-tenant platform adopting it would be
 * inheriting a leak, not a feature.
 *
 * Instead: one refresh token per user, AES-256-GCM encrypted at rest, exchanged
 * for a short-lived access token at delivery time so ④ only ever holds a
 * credential that expires within the hour.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * SCOPES ARE THE POINT OF EC-P5-65. Google returns which scopes the user
 * actually granted — consent screens let people uncheck things — so the grant
 * is recorded rather than assumed. Interlock check 12 reads it and refuses to
 * `send` on a drafts-only grant, turning what would be a failed send and a
 * confused user into an answer before anything is attempted.
 */

/** Create and read drafts. The safer default, and all draft mode needs. */
export const SCOPE_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
/** Actually deliver. Requested only when the user asks to send directly. */
export const SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";

export type GoogleAccess = "draft" | "send";

export class GoogleOAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

/**
 * The redirect URI, from configuration only.
 *
 * NEVER derived from the incoming request's Host header: that is attacker
 * controlled, and a forged Host would send Google's `code` to someone else's
 * origin. Google also requires an exact match against the registered URI, so
 * a config value is the only thing that can work anyway.
 */
export function redirectUri(): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/outreach/oauth/google/callback`;
}

function requireConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError(
      "NOT_CONFIGURED",
      "Google sending is not configured on this server. " +
        "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Build the consent URL.
 *
 * `access_type=offline` with `prompt=consent` is what guarantees a refresh
 * token comes back. Google omits it on re-authorization otherwise, which
 * produces the maddening bug where connecting works the first time and
 * silently yields no storable credential on every subsequent attempt.
 */
export function consentUrl(state: string, access: GoogleAccess): string {
  const { clientId } = requireConfig();

  // Send access needs compose too — drafts are created either way.
  const scopes =
    access === "send" ? [SCOPE_COMPOSE, SCOPE_SEND] : [SCOPE_COMPOSE];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface TokenGrant {
  refreshToken: string;
  accessToken: string;
  /** Space-separated, exactly as Google reports it — the record for check 12. */
  grantedScopes: string;
  email: string | null;
}

/** Exchange the one-time code for tokens. */
export async function exchangeCode(code: string): Promise<TokenGrant> {
  const { clientId, clientSecret } = requireConfig();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    // Status only. The error body can echo the code and the client secret.
    throw new GoogleOAuthError(
      "EXCHANGE_FAILED",
      `Google rejected the authorization (${res.status}).`,
    );
  }

  const data = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };

  if (!data.refresh_token) {
    // Almost always a re-consent where Google withheld the refresh token.
    throw new GoogleOAuthError(
      "NO_REFRESH_TOKEN",
      "Google did not return a refresh token. Remove JobPilot from your " +
        "Google account's third-party access list, then connect again.",
    );
  }

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token ?? "",
    grantedScopes: data.scope ?? "",
    email: data.access_token ? await fetchEmail(data.access_token) : null,
  };
}

/** Which mailbox was connected. Shown in settings so a wrong account is obvious. */
async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { emailAddress?: string };
    return data.emailAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh an access token (EC-P5-64).
 *
 * Returns null on ANY failure, including a revoked grant. The caller treats
 * null as "no usable credential" and clears `preflight_ok_at`, so the next
 * send blocks at interlock check 11 with a re-consent prompt rather than
 * retrying into a token the user has deliberately withdrawn.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<string | null> {
  if (!googleConfigured()) return null;
  const { clientId, clientSecret } = requireConfig();

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    // Never log the response — some error shapes echo the refresh token.
    return null;
  }
}

/**
 * Best-effort revocation at Google when the user disconnects.
 *
 * Deleting our row alone would leave JobPilot listed in the user's Google
 * account forever, which is a promise broken quietly. A failure here is not
 * fatal: the local row still goes, so the platform can no longer send.
 */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // Intentionally ignored — see above.
  }
}

/** True when the grant permits direct sending. Check 12's predicate. */
export function grantAllowsSend(grantedScopes: string | null): boolean {
  return (grantedScopes ?? "").includes(SCOPE_SEND);
}
