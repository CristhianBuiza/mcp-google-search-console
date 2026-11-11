#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runInteractiveAuth } from "./auth.js";

try {
  const config = loadConfig();
  console.log(`Requesting scope(s): ${config.scopes.join(", ")}`);
  const refresh = await runInteractiveAuth(config);
  console.log(`\nSuccess. Token saved to ${config.tokenPath}`);
  console.log("If you prefer env-based config (e.g. containers), you can set:");
  console.log(`GSC_REFRESH_TOKEN=${refresh}`);
} catch (e) {
  console.error(`\nError: ${(e as Error).message}`);
  process.exit(1);
}
