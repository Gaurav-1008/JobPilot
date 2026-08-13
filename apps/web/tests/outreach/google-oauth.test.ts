/**
 * Google OAuth (P5.5.3).
 *
 * The scope assertions carry the most weight: EC-P5-65 turns on JobPilot
 * recording what Google GRANTED rather than what it asked for, and interlock
 * check 12 reads that record to decide whether sending is permitted.
 *
 * The `access_type=offline` / `prompt=consent` pair is asserted because its
 * absence produces the worst kind of bug — connecting works the first time and
 * silently returns no refresh token on every reconnection afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consentUrl,
  exchangeCode,
  googleConfigured,
  GoogleOAuthError,
  grantAllowsSend,
  redirectUri,
  refreshAccessToken,
  SCOPE_COMPOSE,
  SCOPE_SEND,
} from "@/lib/outreach/google-oauth";

const saved = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id-123";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret-456";
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  process.env.NEXT_PUBLIC_APP_URL = "https://jobpilot.example";
});

afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("reports whether the server can complete a flow at all", () => {
    expect(googleConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleConfigured()).toBe(false);
  });

  it("builds the redirect URI from configuration, never from a request host", () => {
    // A Host header is attacker-controlled; deriving the redirect from it would
    // send Google's authorization code to someone else's origin.
    expect(redirectUri()).toBe(
      "https://jobpilot.example/api/outreach/oauth/google/callback",
    );
  });

  it("prefers an explicit redirect URI when set", () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://other.example/cb";
    expect(redirectUri()).toBe("https://other.example/cb");
  });

  it("throws a typed error rather than building a broken consent URL", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => consentUrl("state", "draft")).toThrow(GoogleOAuthError);
  });
});

describe("consent URL", () => {
  it("requests ONLY compose for draft access", () => {
    const url = new URL(consentUrl("st", "draft"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain(SCOPE_COMPOSE);
    // Asking for send when the user chose drafts trains people to click
    // through consent screens without reading them.
    expect(scope).not.toContain(SCOPE_SEND);
  });

  it("requests compose AND send for send access", () => {
    const scope = new URL(consentUrl("st", "send")).searchParams.get("scope") ?? "";
    expect(scope).toContain(SCOPE_COMPOSE);
    expect(scope).toContain(SCOPE_SEND);
  });

  it("asks for offline access with a forced consent prompt", () => {
    const url = new URL(consentUrl("st", "draft"));
    // Without both, Google omits the refresh token on re-authorization and the
    // credential silently cannot be stored.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("carries the CSRF state through unchanged", () => {
    const url = new URL(consentUrl("nonce-abc", "draft"));
    expect(url.searchParams.get("state")).toBe("nonce-abc");
  });

  it("points at Google's authorization endpoint", () => {
    expect(consentUrl("st", "draft")).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
  });
});

describe("code exchange", () => {
  it("returns the granted scopes exactly as Google reported them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return {
            ok: true,
            json: async () => ({
              refresh_token: "refresh-xyz",
              access_token: "access-xyz",
              // The user unchecked "send" on the consent screen.
              scope: SCOPE_COMPOSE,
            }),
          };
        }
        return { ok: true, json: async () => ({ emailAddress: "me@gmail.com" }) };
      }),
    );

    const grant = await exchangeCode("code-1");
    expect(grant.refreshToken).toBe("refresh-xyz");
    expect(grant.grantedScopes).toBe(SCOPE_COMPOSE);
    expect(grant.email).toBe("me@gmail.com");
    // EC-P5-65: requested send, granted compose only — check 12 must block.
    expect(grantAllowsSend(grant.grantedScopes)).toBe(false);
  });

  it("fails loudly when Google returns no refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "a", scope: SCOPE_COMPOSE }),
      })),
    );
    // Storing an access-token-only grant would produce an account that works
    // for an hour and then breaks with no explanation.
    await expect(exchangeCode("code-1")).rejects.toThrow(/refresh token/i);
  });

  it("never puts the response body in the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => `{"error":"invalid_grant","client_secret":"leaked"}`,
        json: async () => ({}),
      })),
    );

    // Google's token errors echo request parameters back.
    await expect(exchangeCode("code-1")).rejects.toThrow(/400/);
    await expect(exchangeCode("code-1")).rejects.not.toThrow(/leaked/);
  });

  it("survives the profile lookup failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("gmail.googleapis.com")
          ? { ok: false, status: 500, json: async () => ({}) }
          : {
              ok: true,
              json: async () => ({
                refresh_token: "r",
                access_token: "a",
                scope: SCOPE_COMPOSE,
              }),
            },
      ),
    );
    // A cosmetic lookup must not fail the whole connection.
    const grant = await exchangeCode("code-1");
    expect(grant.refreshToken).toBe("r");
    expect(grant.email).toBeNull();
  });
});

describe("refresh (EC-P5-64)", () => {
  it("returns a fresh access token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "fresh" }) })),
    );
    expect(await refreshAccessToken("r")).toBe("fresh");
  });

  it("returns null when the grant was revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_grant" }),
      })),
    );
    // The caller clears preflight_ok_at on null, so the next send blocks at
    // check 11 with a re-consent prompt instead of retrying a dead token.
    expect(await refreshAccessToken("r")).toBeNull();
  });

  it("returns null rather than throwing when Google is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await refreshAccessToken("r")).toBeNull();
  });

  it("returns null when the server has no Google configuration", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await refreshAccessToken("r")).toBeNull();
  });
});

describe("grantAllowsSend", () => {
  it("is the predicate interlock check 12 uses", () => {
    expect(grantAllowsSend(`${SCOPE_COMPOSE} ${SCOPE_SEND}`)).toBe(true);
    expect(grantAllowsSend(SCOPE_COMPOSE)).toBe(false);
    // NULL means "unknown", and an escalation may not rest on an assumption.
    expect(grantAllowsSend(null)).toBe(false);
    expect(grantAllowsSend("")).toBe(false);
  });
});
