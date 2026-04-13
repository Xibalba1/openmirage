import { createHash, randomBytes } from "node:crypto";

export type SameSitePolicy = "lax" | "strict" | "none";

export interface SessionContract {
  mode: "magic-link-session";
  sessionCookieHttpOnly: true;
  sessionCookieMaxAgeSeconds: number;
  sessionCookieName: string;
  sessionCookiePath: string;
  sessionCookieSameSite: SameSitePolicy;
  sessionCookieSecure: boolean;
}

export interface SessionContractOptions {
  sessionCookieMaxAgeSeconds?: number;
  sessionCookieName?: string;
  sessionCookiePath?: string;
  sessionCookieSameSite?: SameSitePolicy;
  sessionCookieSecure?: boolean;
}

export interface CookieSerializeOptions {
  expires?: Date;
  httpOnly?: boolean;
  maxAgeSeconds?: number;
  path?: string;
  sameSite?: SameSitePolicy;
  secure?: boolean;
}

export function createSessionContract(
  options: SessionContractOptions = {}
): SessionContract {
  return {
    mode: "magic-link-session",
    sessionCookieName: options.sessionCookieName ?? "openmirage_session",
    sessionCookiePath: options.sessionCookiePath ?? "/",
    sessionCookieSameSite: options.sessionCookieSameSite ?? "lax",
    sessionCookieSecure: options.sessionCookieSecure ?? false,
    sessionCookieHttpOnly: true,
    sessionCookieMaxAgeSeconds:
      options.sessionCookieMaxAgeSeconds ?? 60 * 60 * 24 * 30
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieSerializeOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? "/"}`);

  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${capitalize(options.sameSite)}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createSetSessionCookieHeader(
  token: string,
  contract: SessionContract
): string {
  return serializeCookie(contract.sessionCookieName, token, {
    httpOnly: contract.sessionCookieHttpOnly,
    maxAgeSeconds: contract.sessionCookieMaxAgeSeconds,
    path: contract.sessionCookiePath,
    sameSite: contract.sessionCookieSameSite,
    secure: contract.sessionCookieSecure
  });
}

export function createClearSessionCookieHeader(
  contract: SessionContract
): string {
  return serializeCookie(contract.sessionCookieName, "", {
    expires: new Date(0),
    httpOnly: contract.sessionCookieHttpOnly,
    maxAgeSeconds: 0,
    path: contract.sessionCookiePath,
    sameSite: contract.sessionCookieSameSite,
    secure: contract.sessionCookieSecure
  });
}

export function parseCookieHeader(
  header: string | undefined
): Record<string, string> {
  if (!header) {
    return {};
  }

  const cookies: Record<string, string> = {};

  for (const entry of header.split(";")) {
    const trimmed = entry.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

export function readSessionTokenFromCookie(
  header: string | undefined,
  contract: SessionContract
): string | null {
  const cookies = parseCookieHeader(header);
  return cookies[contract.sessionCookieName] ?? null;
}

export function buildMagicLinkUrl(input: {
  apiBaseUrl: string;
  authPath: string;
  redirectTo?: string;
  token: string;
}): string {
  const url = new URL(
    `${input.apiBaseUrl}${input.authPath}/magic-link/consume`
  );
  url.searchParams.set("token", input.token);

  if (input.redirectTo) {
    url.searchParams.set("redirectTo", input.redirectTo);
  }

  return url.toString();
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
