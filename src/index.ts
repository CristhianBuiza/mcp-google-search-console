#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAuthorizedClient } from "./auth.js";
import { createSearchConsoleClients } from "./client.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

async function main() {
  const config = loadConfig();
  const auth = await getAuthorizedClient(config);
  const clients = createSearchConsoleClients(auth);

  const server = new McpServer({ name: "google-search-console", version: "1.0.0" });
  registerTools(server, clients, { readonly: config.readonly });

  await server.connect(new StdioServerTransport());
  // IMPORTANT: stdout is the MCP channel; log to stderr only.
  console.error(`[gsc] MCP server ready (${config.readonly ? "read-only" : "read/write"} mode)`);
}

main().catch((e) => {
  console.error(`[gsc] fatal: ${(e as Error).message}`);
  process.exit(1);
});
