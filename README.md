# mcp-google-search-console

MCP (Model Context Protocol) server for **Google Search Console**. It lets an AI client query search analytics, inspect URLs, manage sitemaps and list properties, using the official Google APIs with **OAuth2**.

- Search Analytics, Sites and Sitemaps use the **Webmasters API v3**.
- URL Inspection is **not** part of v3. Google ships it in the **Search Console API v1** (`searchconsole.googleapis.com`), so the server uses that for `gsc_inspect_url`. Both APIs are enabled by the same "Google Search Console API" switch in Cloud Console, and they share the same scopes.
- Transport: stdio. Runtime: Node.js ≥ 20. Language: TypeScript.

## Tools

| Tool | What it does | Mode |
|---|---|---|
| `gsc_list_sites` | List accessible properties and permission levels | read |
| `gsc_get_site` | Permission level for one property | read |
| `gsc_search_analytics` | Clicks / impressions / CTR / position by `query`, `page`, `country`, `device`, `date`, `searchAppearance`, `hour`, with filters, search type, data state, pagination | read |
| `gsc_inspect_url` | URL Inspection: index status, canonical, last crawl, mobile usability, rich results | read |
| `gsc_list_sitemaps` | List submitted sitemaps and their status | read |
| `gsc_get_sitemap` | Status of one sitemap | read |
| `gsc_submit_sitemap` | Submit or resubmit a sitemap | write |
| `gsc_delete_sitemap` | Remove a sitemap from Search Console | write |
| `gsc_add_site` | Add a URL-prefix property | write |
| `gsc_delete_site` | Remove a property from the account | write |

Write tools are not registered when `GSC_READONLY=true`.

### `gsc_search_analytics` parameters

| Param | Notes |
|---|---|
| `siteUrl` | `https://example.com/` (URL-prefix, trailing slash) or `sc-domain:example.com` |
| `startDate`, `endDate` | `YYYY-MM-DD`, inclusive. Default end is today minus 2 days (data lag) |
| `days` | Window size when `startDate` is omitted. Default 28 |
| `dimensions` | Any of `query, page, country, device, date, searchAppearance, hour` |
| `filters` | `[{dimension, operator, expression}]`. Operators: `equals, notEquals, contains, notContains, includingRegex, excludingRegex` |
| `searchType` | `web` (default), `image`, `video`, `news`, `discover`, `googleNews` |
| `dataState` | `final` (default), `all`, `hourly_all` |
| `aggregationType` | `auto`, `byPage`, `byProperty` |
| `rowLimit`, `startRow` | Up to 25000 rows per call. The response includes `nextStartRow` for paging |

Example prompts: "Top 20 queries for sc-domain:example.com in the last 28 days", "Which pages lost clicks compared to last month?", "Is https://example.com/blog/x indexed?", "Submit https://example.com/sitemap.xml".

## Setup

### 1. Install and build

```bash
git clone <this repo> mcp-google-search-console
cd mcp-google-search-console
npm install
npm run build
```

### 2. Create OAuth credentials in Google Cloud Console

1. Go to <https://console.cloud.google.com/> and create or select a project.
2. **Enable the API**: *APIs & Services → Library* → search **"Google Search Console API"** → **Enable**.
3. **Configure the consent screen**: *APIs & Services → OAuth consent screen* (or *Google Auth Platform*).
   - User type: **External** (or Internal if you use Google Workspace).
   - Add the scope `https://www.googleapis.com/auth/webmasters` (or `.../webmasters.readonly` for read-only).
   - While the app is in **Testing** status, add your Google account under **Test users**. Note that Google expires refresh tokens after 7 days for apps in Testing. For long-term use, click **Publish app** (no verification is needed for personal use with an "unverified app" warning), or use an Internal app.
4. **Create the credentials**: *APIs & Services → Credentials → Create credentials → OAuth client ID* → Application type **Desktop app**. Copy the **Client ID** and **Client secret**, or download the JSON.

### 3. Scopes

| Scope | Used for |
|---|---|
| `https://www.googleapis.com/auth/webmasters` | Default. Read and write: everything, including submitting sitemaps and adding/removing sites |
| `https://www.googleapis.com/auth/webmasters.readonly` | Used when `GSC_READONLY=true`. Read-only, and write tools are hidden |

If you change `GSC_READONLY`, re-run the authorization step to get a token with the right scope.

The Google account you authorize must have access to the properties in Search Console (Owner, Full or Restricted user). Write operations need more than Restricted.

### 4. Environment variables

| Variable | Required | Description |
|---|---|---|
| `GSC_CLIENT_ID` | yes* | OAuth client ID |
| `GSC_CLIENT_SECRET` | yes* | OAuth client secret |
| `GSC_CREDENTIALS_FILE` | alt.* | Path to the downloaded `client_secret_*.json` (used when ID/secret are not set) |
| `GSC_TOKEN_PATH` | no | Token file location. Default `~/.config/mcp-google-search-console/token.json` (mode 600) |
| `GSC_REFRESH_TOKEN` | no | Use a refresh token directly instead of the token file (handy for containers/CI) |
| `GSC_READONLY` | no | `true` = read-only scope, write tools hidden. Default `false` |

\* Either `GSC_CLIENT_ID` + `GSC_CLIENT_SECRET`, or `GSC_CREDENTIALS_FILE`. See `.env.example`.

### 5. Authorize once

```bash
export GSC_CLIENT_ID=...apps.googleusercontent.com
export GSC_CLIENT_SECRET=...
npm run auth
```

It prints a URL. Open it, grant access, and the browser redirects to a temporary local server on `127.0.0.1` (OAuth loopback flow with PKCE). The refresh token is saved to the token file. It also prints the refresh token if you prefer `GSC_REFRESH_TOKEN`. Access tokens refresh automatically afterwards.

The MCP server itself never opens an interactive flow, because stdout is reserved for the MCP protocol. If no token exists, it exits with a message telling you to run `npm run auth`.

### 6. Configure your MCP client

Use the absolute path to `dist/index.js`.

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`) and **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-search-console": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-google-search-console/dist/index.js"],
      "env": {
        "GSC_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GSC_CLIENT_SECRET": "your-client-secret",
        "GSC_READONLY": "false"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add google-search-console \
  -e GSC_CLIENT_ID=... -e GSC_CLIENT_SECRET=... \
  -- node /absolute/path/to/mcp-google-search-console/dist/index.js
```

Restart or reload the client and the tools appear with the `gsc_` prefix.

## Development

```bash
npm run build       # compile to dist/
npm run dev         # tsc --watch
npm run typecheck
npm test            # unit tests (after build)
npx @modelcontextprotocol/inspector node dist/index.js   # interactive testing
```

Layout:

```
src/
  index.ts       MCP server entry (stdio)
  auth-cli.ts    `npm run auth` one-time OAuth flow
  auth.ts        OAuth2 client, token storage/refresh, loopback+PKCE flow
  config.ts      env parsing, scopes
  client.ts      googleapis clients (webmasters v3 + searchconsole v1)
  tools.ts       tool definitions (zod schemas)
  util.ts        date range, row mapping, error formatting
  test/          unit tests
```

## Troubleshooting

- **`403 ... insufficient permission`**: the authorized account does not have access to that property, or you used a read-only scope for a write tool.
- **`403 ... API has not been used / is disabled`**: enable the "Google Search Console API" in the project that owns your OAuth client.
- **`invalid_grant`**: the token was revoked or expired (7 days in Testing mode). Run `npm run auth` again.
- **`siteUrl` not found**: use the exact string from `gsc_list_sites`. URL-prefix properties need the trailing slash and the right protocol/`www`.
- **No refresh token returned**: revoke the app at <https://myaccount.google.com/permissions> and re-run `npm run auth`.
- **Empty rows for recent dates**: Search Console data lags about 2 days. Use `dataState: "all"` for fresher, non-final data.

## Security notes

Never commit the token file, `.env` or `client_secret*.json` (they are in `.gitignore`). The token grants access to your Search Console data. Use `GSC_READONLY=true` if you do not need write operations.

## License

MIT
