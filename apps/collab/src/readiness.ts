import { type ServiceCheck } from "@openmirage/types";

export async function inspectApiDependency(
  apiBaseUrl: string,
  authPath: string,
  fetchImpl: typeof fetch = fetch
): Promise<ServiceCheck> {
  try {
    const response = await fetchImpl(new URL(`${authPath}/me`, apiBaseUrl), {
      method: "GET"
    });

    if (response.status === 200 || response.status === 401) {
      return {
        ok: true,
        summary: `api auth/session boundary reachable at ${apiBaseUrl}`
      };
    }

    return {
      ok: false,
      summary: `api auth/session boundary returned ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      summary: `api auth/session boundary unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}
