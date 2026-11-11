import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export function createSearchConsoleClients(auth: OAuth2Client) {
  return {
    // Webmasters v3: sites, sitemaps, search analytics
    webmasters: google.webmasters({ version: "v3", auth }),
    // Search Console v1: URL Inspection (not part of webmasters v3)
    searchconsole: google.searchconsole({ version: "v1", auth }),
  };
}

export type SearchConsoleClients = ReturnType<typeof createSearchConsoleClients>;
