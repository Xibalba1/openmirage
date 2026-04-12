export interface SessionContract {
  mode: "magic-link-session";
  sessionCookieName: string;
}

export interface SessionContractOptions {
  sessionCookieName?: string;
}

export function createSessionContract(
  options: SessionContractOptions = {}
): SessionContract {
  return {
    mode: "magic-link-session",
    sessionCookieName: options.sessionCookieName ?? "openmirage_session"
  };
}
