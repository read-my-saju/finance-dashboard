/**
 * 3 개 dashboard route (summary/daily/meta-campaigns) 가 공유하는
 * in-memory cache. 같은 기간 요청을 dashboard 한 화면에서 동시에 3번 부르므로
 * PortOne + Meta API 를 매번 새로 치지 않도록 묶어준다.
 *
 * Vercel serverless cold start 시에는 비어있다 (정상 — 첫 요청 cost).
 * warm container 내 5분간 유효.
 */
import { type PortonePayment } from "./portone";
import { fetchCombinedPayments } from "./payments-source";
import {
  aggregateMetaByCampaign,
  aggregateMetaByDay,
  fetchCampaignBudgets,
  type MetaCampaignBudget,
  type MetaInsightRow,
} from "./meta";
import { loadIncrementalRows } from "./meta-store";
import { computeProfit, type ProfitSummary } from "./profit";

const TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  key: string;
  expiresAt: number;
  payments: PortonePayment[];
  metaRows: MetaInsightRow[];
  // 캠페인 예산은 기간과 무관하므로 한 번 받아 같은 entry 안에서 재사용.
  metaBudgets: Map<string, MetaCampaignBudget>;
  metaError: string | null;
};

let cache: CacheEntry | null = null;

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

  // PortOne(과거) + Toss(2026-06-19~) 합산. 양쪽 모두 실패할 때만 throw.
  const combined = await fetchCombinedPayments({ from: opts.from, until: opts.until });
  if (combined.bothFailed) {
    throw new Error(combined.warnings.join(" / ") || "결제 조회 실패");
  }
  const payments = combined.payments;

  // Meta 광고 데이터: rolling 7일 incremental sync 를 거친 영속 저장소에서 로드.
  // KV 가 비활성이면 자동으로 [from, until] 전체 재조회 (fallback).
  const incremental = await loadIncrementalRows({
    requestedFrom: opts.from,
    requestedUntil: opts.until,
    force: Boolean(opts.force),
  });
  const metaRows: MetaInsightRow[] = incremental.rows;
  let metaError: string | null = incremental.metaError;

  // 예산은 KV 대신 매 호출 시 Meta /campaigns 엔드포인트에서 받음 — 일별 캐싱이 무의미한
  // 정적 메타데이터이고, 캠페인 수가 적어 단일 페이지로 끝나므로 cost 적음.
  // 실패는 KPI/캠페인 표시를 막지 않게 흡수.
  let metaBudgets: Map<string, MetaCampaignBudget> = new Map();
  try {
    metaBudgets = await fetchCampaignBudgets();
  } catch (e: any) {
    console.warn("[dashboard-cache] fetchCampaignBudgets failed:", String(e?.message || e).slice(0, 200));
  }

  const entry: CacheEntry = {
    key,
    expiresAt: now + TTL_MS,
    payments,
    metaRows,
    metaBudgets,
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

export type MetaCampaignRow = {
  campaignId: string;
  campaignName: string;
  // 결과(구매수) — Meta insights actions[].action_type=purchase 합.
  purchases: number;
  // 결과당 비용(CPA) — spend / purchases. purchases=0 이면 null.
  cpa: number | null;
  // 예산 — daily_budget 또는 lifetime_budget. 둘 다 null 이면 null.
  // 표시 시 "₩X/일" or "₩X (총액)" 으로 구분.
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spend: number;
  // ROAS — Meta 가 트래킹한 매출 / 광고비. 광고비=0 또는 매출=0 이면 null.
  roas: number | null;
  // CTR — clicks / impressions × 100. impressions=0 이면 null.
  ctr: number | null;
  // 빈도 — impressions / reach. reach=0 이면 null.
  frequency: number | null;
  // 구매전환율 (CVR) — purchases / clicks × 100. clicks=0 이면 null.
  cvr: number | null;
  // CPM — spend / impressions × 1000. impressions=0 이면 null.
  cpm: number | null;
};

export async function loadMetaCampaigns(opts: LoadOptions): Promise<{
  campaigns: MetaCampaignRow[];
  metaError: string | null;
  cached: boolean;
}> {
  const now = Date.now();
  const wasCached = !opts.force && cache && cache.key === `${opts.from}|${opts.until}` && cache.expiresAt > now;
  const entry = await loadRawData(opts);
  const agg = aggregateMetaByCampaign(entry.metaRows);
  const campaigns: MetaCampaignRow[] = agg.map((r) => {
    const budget = entry.metaBudgets.get(r.campaignId);
    const cpa = r.purchases > 0 ? r.spend / r.purchases : null;
    const roas = r.spend > 0 && r.purchaseValue > 0 ? (r.purchaseValue / r.spend) * 100 : null;
    const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null;
    const frequency = r.reach > 0 ? r.impressions / r.reach : null;
    const cvr = r.clicks > 0 ? (r.purchases / r.clicks) * 100 : null;
    const cpm = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null;
    return {
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      purchases: r.purchases,
      cpa,
      dailyBudget: budget?.dailyBudget ?? null,
      lifetimeBudget: budget?.lifetimeBudget ?? null,
      spend: r.spend,
      roas,
      ctr,
      frequency,
      cvr,
      cpm,
    };
  });
  return { campaigns, metaError: entry.metaError, cached: Boolean(wasCached) };
}

export function invalidateCache(): void {
  cache = null;
}
