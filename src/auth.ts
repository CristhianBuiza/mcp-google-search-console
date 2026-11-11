import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import type { Config } from "./config.js";

export function createOAuthClient(config: Config, redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri,
  });
}

async function readToken(path: string): Promise<Credentials | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Credentials;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Cannot read token file ${path}: ${(e as Error).message}`);
  }
}

async function saveToken(path: string, tokens: Credentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

/**
 * Returns an authorized OAuth2 client for the running server.
 * Uses GSC_REFRESH_TOKEN or the token file; never starts an interactive flow
 * (stdout is the MCP transport). Run `npm run auth` once to create the token.
 */
export async function getAuthorizedClient(config: Config): Promise<OAuth2Client> {
  const client = createOAuthClient(config);

  let tokens: Credentials | undefined;
  if (config.refreshToken) {
    tokens = { refresh_token: config.refreshToken };
  } else {
    tokens = await readToken(config.tokenPath);
  }
  if (!tokens?.refresh_token && !tokens?.access_token) {
    throw new Error(
      `No OAuth token found at ${config.tokenPath}. Run "npm run auth" (or "npx mcp-google-search-console-auth") once to authorize, or set GSC_REFRESH_TOKEN.`,
    );
  }
  client.setCredentials(tokens);

  // Persist refreshed tokens (Google may rotate them) when using a token file.
  if (!config.refreshToken) {
    client.on("tokens", (fresh) => {
      const merged = { ...tokens, ...fresh, refresh_token: fresh.refresh_token ?? tokens?.refresh_token };
      tokens = merged;
      saveToken(config.tokenPath, merged).catch((e) =>
        console.error(`[gsc] could not persist refreshed token: ${(e as Error).message}`),
      );
    });
  }
  return client;
}

/** Interactive loopback (127.0.0.1) + PKCE authorization flow. Used by the `auth` CLI only. */
export async function runInteractiveAuth(config: Config): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const client = createOAuthClient(config, redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // guarantees a refresh_token is returned
    scope: config.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  console.log("\nOpen this URL in your browser and grant access:\n");
  console.log(authUrl + "\n");
  console.log(`Waiting for the redirect on ${redirectUri} ...`);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for authorization (5 min).")), 5 * 60_000);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const c = url.searchParams.get("code");
      res.writeHead(err || !c ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        err || !c
          ? `<h1>Authorization failed</h1><p>${err ?? "No code received"}</p>`
          : "<h1>Authorized</h1><p>You can close this tab and return to the terminal.</p>",
      );
      clearTimeout(timer);
      err || !c ? reject(new Error(`Authorization failed: ${err ?? "no code"}`)) : resolve(c);
    });
  }).finally(() => server.close());

  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke the app at https://myaccount.google.com/permissions and retry.",
    );
  }
  await saveToken(config.tokenPath, tokens);
  return tokens.refresh_token;
}
