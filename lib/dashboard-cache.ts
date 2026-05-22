/**
 * 3 개 dashboard route (summary/daily/meta-campaigns) 가 공유하는
 * in-memory cache. 같은 기간 요청을 dashboard 한 화면에서 동시에 3번 부르므로
 * PortOne + Meta API 를 매번 새로 치지 않도록 묶어준다.
 *
 * Vercel serverless cold start 시에는 비어있다 (정상 — 첫 요청 cost).
 * warm container 내 5분간 유효.
 */
import { fetchAllPaidPayments, type PortonePayment } from "./portone";
import {
  aggregateMetaByCampaign,
  aggregateMetaByDay,
  fetchDailyCampaignInsights,
  MetaApiError,
  MetaConfigError,
  type MetaInsightRow,
} from "./meta";
import { computeProfit, type ProfitSummary } from "./profit";

const TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  key: string;
  expiresAt: number;
  payments: PortonePayment[];
  metaRows: MetaInsightRow[];
  metaError: string | null;
};

let cache: CacheEntry | null = null;

function isoStartOfDay(s: string): string {
  return new Date(s + "T00:00:00+09:00").toISOString();
}
function isoEndOfDay(s: string): string {
  return new Date(s + "T23:59:59+09:00").toISOString();
}

export type LoadOptions = {
  from: string;
  until: string;
  force?: boolean;
};

async function loadRawData(opts: LoadOptions): Promise<CacheEntry> {
  const key = `${opts.from}|${opts.until}`;
  const now = Date.now();
  if (!opts.force && cache && cache.key === key && cache.expiresAt > now) {
    return cache;
  }

  const { items: payments } = await fetchAllPaidPayments({
    fromISO: isoStartOfDay(opts.from),
    untilISO: isoEndOfDay(opts.until),
  });

  let metaRows: MetaInsightRow[] = [];
  let metaError: string | null = null;
  try {
    const { rows } = await fetchDailyCampaignInsights({
      from: opts.from,
      until: opts.until,
    });
    metaRows = rows;
  } catch (e: any) {
    if (e instanceof MetaConfigError) {
      metaError = e.message;
    } else if (e instanceof MetaApiError) {
      metaError = e.userMessage;
    } else {
      metaError = `Meta 광고 데이터를 불러오지 못했습니다: ${String(e?.message || e).slice(0, 200)}`;
    }
  }

  const entry: CacheEntry = {
    key,
    expiresAt: now + TTL_MS,
    payments,
    metaRows,
    metaError,
  };
  cache = entry;
  return entry;
}

export async function loadProfitSummary(opts: LoadOptions & {
  pgFeeRate?: number;
  reportCostPerUnit?: number;
}): Promise<{ summary: ProfitSummary; metaError: string | null; cached: boolean }> {
  const now = Date.now();
  const wasCached = !opts.force && cache && cache.key === `${opts.from}|${opts.until}` && cache.expiresAt > now;
  const entry = await loadRawData(opts);
  const metaByDay = aggregateMetaByDay(entry.metaRows);
  const summary = computeProfit({
    payments: entry.payments,
    metaByDay,
    range: { from: opts.from, until: opts.until },
    pgFeeRate: opts.pgFeeRate,
    reportCostPerUnit: opts.reportCostPerUnit,
  });
  return { summary, metaError: entry.metaError, cached: Boolean(wasCached) };
}

export async function loadMetaCampaigns(opts: LoadOptions): Promise<{
  campaigns: Array<{
    campaignId: string;
    campaignName: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
    cpc: number | null;
  }>;
  metaError: string | null;
  cached: boolean;
}> {
  const now = Date.now();
  const wasCached = !opts.force && cache && cache.key === `${opts.from}|${opts.until}` && cache.expiresAt > now;
  const entry = await loadRawData(opts);
  const agg = aggregateMetaByCampaign(entry.metaRows);
  const campaigns = agg.map((r) => ({
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
    cpc: r.clicks > 0 ? r.spend / r.clicks : null,
  }));
  return { campaigns, metaError: entry.metaError, cached: Boolean(wasCached) };
}

export function invalidateCache(): void {
  cache = null;
}
