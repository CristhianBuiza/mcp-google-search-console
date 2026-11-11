export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves the date range for Search Analytics.
 * Search Console data lags ~2 days, so the default end date is today - 2 (UTC).
 * Defaults to the last 28 days when nothing is given.
 */
export function resolveDateRange(
  opts: { startDate?: string; endDate?: string; days?: number },
  now: Date = new Date(),
): { startDate: string; endDate: string } {
  const day = 86_400_000;
  const endDate = opts.endDate ?? formatDate(new Date(now.getTime() - 2 * day));
  let startDate = opts.startDate;
  if (!startDate) {
    const days = opts.days ?? 28;
    startDate = formatDate(new Date(Date.parse(endDate + "T00:00:00Z") - (days - 1) * day));
  }
  if (startDate > endDate) {
    throw new Error(`startDate (${startDate}) must not be after endDate (${endDate}).`);
  }
  return { startDate, endDate };
}

export interface RawRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

/** Turns `{keys:[..]}` rows into objects keyed by the requested dimension names. */
export function mapRows(rows: RawRow[] | null | undefined, dimensions: string[]) {
  return (rows ?? []).map((r) => {
    const out: Record<string, unknown> = {};
    dimensions.forEach((dim, i) => {
      out[dim] = r.keys?.[i];
    });
    out.clicks = r.clicks ?? 0;
    out.impressions = r.impressions ?? 0;
    out.ctr = r.ctr == null ? 0 : Math.round(r.ctr * 10_000) / 10_000;
    out.position = r.position == null ? 0 : Math.round(r.position * 100) / 100;
    return out;
  });
}

/** Extracts a readable message from googleapis / gaxios errors. */
export function errorMessage(e: unknown): string {
  const err = e as {
    message?: string;
    code?: number | string;
    response?: { status?: number; data?: { error?: { message?: string; status?: string } | string; error_description?: string } };
  };
  const data = err.response?.data;
  const apiMsg =
    typeof data?.error === "object" ? data.error?.message : (data?.error_description ?? data?.error);
  const status = err.response?.status ?? err.code;
  const base = apiMsg ?? err.message ?? String(e);
  const hint =
    status === 403
      ? " (403: the authorized Google account lacks permission on this property, the Search Console API is not enabled in your Cloud project, or the scope is read-only for a write operation.)"
      : status === 401 || /invalid_grant/.test(String(base))
        ? " (Authentication problem: re-run `npm run auth` to refresh the token.)"
        : "";
  return `${base}${status ? ` [${status}]` : ""}${hint}`;
}
