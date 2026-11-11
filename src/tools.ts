import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SearchConsoleClients } from "./client.js";
import { DATE_RE, errorMessage, mapRows, resolveDateRange } from "./util.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${errorMessage(e)}` }], isError: true };
  }
}

const siteUrl = z
  .string()
  .min(1)
  .describe(
    "Property as shown in Search Console: URL-prefix property with trailing slash (e.g. 'https://example.com/') or domain property ('sc-domain:example.com').",
  );
const isoDate = z.string().regex(DATE_RE, "Use YYYY-MM-DD");

const DIMENSIONS = ["query", "page", "country", "device", "date", "searchAppearance", "hour"] as const;

export function registerTools(server: McpServer, gsc: SearchConsoleClients, opts: { readonly: boolean }) {
  const { webmasters, searchconsole } = gsc;

  // ---------- Sites ----------
  server.registerTool(
    "gsc_list_sites",
    {
      title: "List Search Console sites",
      description: "List all Search Console properties the authorized account can access, with permission level.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      run(async () => {
        const { data } = await webmasters.sites.list();
        return data.siteEntry ?? [];
      }),
  );

  server.registerTool(
    "gsc_get_site",
    {
      title: "Get site details",
      description: "Get permission level for one Search Console property.",
      inputSchema: { siteUrl },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ siteUrl }) =>
      run(async () => {
        const { data } = await webmasters.sites.get({ siteUrl });
        return data;
      }),
  );

  // ---------- Search analytics ----------
  server.registerTool(
    "gsc_search_analytics",
    {
      title: "Query search analytics",
      description:
        "Query Search Console performance data (clicks, impressions, CTR, average position) grouped by dimensions. " +
        "Dates are inclusive, YYYY-MM-DD (PT time). Data lags ~2 days. If no dates are given, uses the last `days` (default 28) ending 2 days ago. " +
        "Rows are returned as objects keyed by the requested dimension names.",
      inputSchema: {
        siteUrl,
        startDate: isoDate.optional().describe("Start date (inclusive). Overrides `days`."),
        endDate: isoDate.optional().describe("End date (inclusive). Default: 2 days ago."),
        days: z.number().int().min(1).max(500).optional().describe("Window size in days when startDate is omitted. Default 28."),
        dimensions: z
          .array(z.enum(DIMENSIONS))
          .max(7)
          .optional()
          .describe("Group by these dimensions, in order. Omit for a single totals row."),
        filters: z
          .array(
            z.object({
              dimension: z.enum(["query", "page", "country", "device", "searchAppearance"]),
              operator: z
                .enum(["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"])
                .default("equals"),
              expression: z.string().describe("Value to match. country uses ISO-3166-1 alpha-3 (e.g. 'usa', 'esp'); device: DESKTOP|MOBILE|TABLET."),
            }),
          )
          .optional()
          .describe("Filters combined with AND."),
        searchType: z
          .enum(["web", "image", "video", "news", "discover", "googleNews"])
          .optional()
          .describe("Search type. Default 'web'."),
        dataState: z
          .enum(["final", "all", "hourly_all"])
          .optional()
          .describe("'final' = confirmed data only; 'all' includes fresh (partial) data. Default 'final'."),
        aggregationType: z.enum(["auto", "byPage", "byProperty"]).optional(),
        rowLimit: z.number().int().min(1).max(25000).default(100).describe("Max rows (1-25000). Default 100."),
        startRow: z.number().int().min(0).default(0).describe("Zero-based row offset for pagination."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        const { startDate, endDate } = resolveDateRange(a);
        const dimensions = a.dimensions ?? [];
        const { data } = await webmasters.searchanalytics.query({
          siteUrl: a.siteUrl,
          requestBody: {
            startDate,
            endDate,
            dimensions,
            searchType: a.searchType,
            dataState: a.dataState,
            aggregationType: a.aggregationType,
            rowLimit: a.rowLimit,
            startRow: a.startRow,
            dimensionFilterGroups: a.filters?.length
              ? [{ groupType: "and", filters: a.filters }]
              : undefined,
          },
        });
        const rows = mapRows(data.rows, dimensions);
        return {
          siteUrl: a.siteUrl,
          startDate,
          endDate,
          dimensions,
          rowCount: rows.length,
          startRow: a.startRow,
          nextStartRow: rows.length === a.rowLimit ? a.startRow + rows.length : null,
          responseAggregationType: data.responseAggregationType,
          rows,
        };
      }),
  );

  // ---------- URL inspection ----------
  server.registerTool(
    "gsc_inspect_url",
    {
      title: "Inspect URL",
      description:
        "Run Google's URL Inspection for a URL: index status, last crawl, canonical, mobile usability, rich results, AMP. " +
        "The URL must belong to the given property. Quota: ~2000 inspections/day and 600/min per property.",
      inputSchema: {
        siteUrl,
        inspectionUrl: z.string().url().describe("Fully-qualified URL to inspect."),
        languageCode: z.string().default("en-US").describe("Language for localized messages, e.g. 'es-ES'."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        const { data } = await searchconsole.urlInspection.index.inspect({
          requestBody: { siteUrl: a.siteUrl, inspectionUrl: a.inspectionUrl, languageCode: a.languageCode },
        });
        return data.inspectionResult ?? data;
      }),
  );

  // ---------- Sitemaps ----------
  server.registerTool(
    "gsc_list_sitemaps",
    {
      title: "List sitemaps",
      description: "List sitemaps submitted for a property, with status, errors/warnings and last download time.",
      inputSchema: {
        siteUrl,
        sitemapIndex: z.string().url().optional().describe("Only list sitemaps contained in this sitemap index URL."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ siteUrl, sitemapIndex }) =>
      run(async () => {
        const { data } = await webmasters.sitemaps.list({ siteUrl, sitemapIndex });
        return data.sitemap ?? [];
      }),
  );

  server.registerTool(
    "gsc_get_sitemap",
    {
      title: "Get sitemap status",
      description: "Get the processing status of one sitemap (pending, errors, warnings, submitted vs indexed counts).",
      inputSchema: { siteUrl, feedpath: z.string().url().describe("Full sitemap URL, e.g. 'https://example.com/sitemap.xml'.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ siteUrl, feedpath }) =>
      run(async () => {
        const { data } = await webmasters.sitemaps.get({ siteUrl, feedpath });
        return data;
      }),
  );

  if (opts.readonly) return; // write tools are hidden in read-only mode

  server.registerTool(
    "gsc_submit_sitemap",
    {
      title: "Submit sitemap",
      description: "Submit (or resubmit) a sitemap to Search Console for a property. Requires the full (non read-only) scope.",
      inputSchema: { siteUrl, feedpath: z.string().url().describe("Full sitemap URL.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ siteUrl, feedpath }) =>
      run(async () => {
        await webmasters.sitemaps.submit({ siteUrl, feedpath });
        return `Sitemap submitted: ${feedpath} (property ${siteUrl}). Use gsc_get_sitemap to check its status.`;
      }),
  );

  server.registerTool(
    "gsc_delete_sitemap",
    {
      title: "Delete sitemap",
      description: "Remove a sitemap from Search Console for a property (does not delete the file on your server).",
      inputSchema: { siteUrl, feedpath: z.string().url().describe("Full sitemap URL.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ siteUrl, feedpath }) =>
      run(async () => {
        await webmasters.sitemaps.delete({ siteUrl, feedpath });
        return `Sitemap removed: ${feedpath} (property ${siteUrl}).`;
      }),
  );

  server.registerTool(
    "gsc_add_site",
    {
      title: "Add site",
      description:
        "Add a URL-prefix property to the account's Search Console (it still must be verified separately). Domain properties cannot be added via API.",
      inputSchema: { siteUrl },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ siteUrl }) =>
      run(async () => {
        await webmasters.sites.add({ siteUrl });
        return `Site added: ${siteUrl}. Verify ownership in Search Console to access its data.`;
      }),
  );

  server.registerTool(
    "gsc_delete_site",
    {
      title: "Delete site",
      description: "Remove a property from the account's Search Console. Destructive: loses access to the property's data for this user.",
      inputSchema: { siteUrl },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ siteUrl }) =>
      run(async () => {
        await webmasters.sites.delete({ siteUrl });
        return `Site removed: ${siteUrl}.`;
      }),
  );
}
