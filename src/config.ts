import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SCOPE_FULL = "https://www.googleapis.com/auth/webmasters";
export const SCOPE_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";

export interface Config {
  clientId: string;
  clientSecret: string;
  tokenPath: string;
  refreshToken?: string;
  readonly: boolean;
  scopes: string[];
}

interface ClientSecretFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

export function isTruthy(v: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let clientId = env.GSC_CLIENT_ID?.trim();
  let clientSecret = env.GSC_CLIENT_SECRET?.trim();

  if ((!clientId || !clientSecret) && env.GSC_CREDENTIALS_FILE) {
    let parsed: ClientSecretFile;
    try {
      parsed = JSON.parse(readFileSync(env.GSC_CREDENTIALS_FILE, "utf8"));
    } catch (e) {
      throw new Error(
        `Cannot read GSC_CREDENTIALS_FILE (${env.GSC_CREDENTIALS_FILE}): ${(e as Error).message}`,
      );
    }
    const c = parsed.installed ?? parsed.web;
    if (!c) throw new Error("GSC_CREDENTIALS_FILE has neither an 'installed' nor a 'web' section.");
    clientId = c.client_id;
    clientSecret = c.client_secret;
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing OAuth client. Set GSC_CLIENT_ID and GSC_CLIENT_SECRET, or GSC_CREDENTIALS_FILE. See README.",
    );
  }

  const readonly = isTruthy(env.GSC_READONLY);
  return {
    clientId,
    clientSecret,
    tokenPath:
      env.GSC_TOKEN_PATH ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mcp-google-search-console", "token.json"),
    refreshToken: env.GSC_REFRESH_TOKEN?.trim() || undefined,
    readonly,
    scopes: [readonly ? SCOPE_READONLY : SCOPE_FULL],
  };
}
