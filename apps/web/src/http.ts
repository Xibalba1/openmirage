export function buildJsonRequestHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);

  if (!headers.has("content-type") && init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return headers;
}
