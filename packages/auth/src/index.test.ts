import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMagicLinkUrl,
  createClearSessionCookieHeader,
  createSessionContract,
  createSetSessionCookieHeader,
  isValidEmail,
  parseCookieHeader,
  readSessionTokenFromCookie
} from "./index.js";

test("session contract defaults remain development-friendly", () => {
  const contract = createSessionContract();

  assert.equal(contract.sessionCookieName, "openmirage_session");
  assert.equal(contract.sessionCookiePath, "/");
  assert.equal(contract.sessionCookieSameSite, "lax");
  assert.equal(contract.sessionCookieSecure, false);
  assert.equal(contract.sessionCookieMaxAgeSeconds, 60 * 60 * 24 * 30);
});

test("session cookie helpers serialize and clear cookies", () => {
  const contract = createSessionContract({
    sessionCookieName: "om_session",
    sessionCookieSecure: true
  });

  const setCookie = createSetSessionCookieHeader("opaque-token", contract);
  const clearCookie = createClearSessionCookieHeader(contract);

  assert.match(setCookie, /om_session=opaque-token/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(clearCookie, /Max-Age=0/);
  assert.match(clearCookie, /Expires=Thu, 01 Jan 1970/);
});

test("cookie parsing reads the configured session token", () => {
  const contract = createSessionContract({
    sessionCookieName: "om_session"
  });
  const cookieHeader = "theme=dark; om_session=abc123; foo=bar";

  assert.equal(parseCookieHeader(cookieHeader).theme, "dark");
  assert.equal(readSessionTokenFromCookie(cookieHeader, contract), "abc123");
  assert.equal(readSessionTokenFromCookie(undefined, contract), null);
});

test("magic link builder preserves token and redirect target", () => {
  const url = buildMagicLinkUrl({
    apiBaseUrl: "http://localhost:4000",
    authPath: "/auth",
    redirectTo: "http://localhost:3000",
    token: "token-123"
  });

  assert.equal(
    url,
    "http://localhost:4000/auth/magic-link/consume?token=token-123&redirectTo=http%3A%2F%2Flocalhost%3A3000"
  );
});

test("email validation accepts common addresses and rejects malformed input", () => {
  assert.equal(isValidEmail("dev@openmirage.local"), true);
  assert.equal(isValidEmail("bad-email"), false);
});
