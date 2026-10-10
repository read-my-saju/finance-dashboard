/**
 * dashboard route (summary/daily/meta-campaigns/channels) 가 공유하는
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
import { MixpanelConfigError } from "./mixpanel";
import { loadStoredAttributions } from "./mixpanel-store";
import { buildChannelPeriod, type ChannelPeriod } from "./channel-revenue";
import type { CampaignRef } from "./channel";

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

// 기간별 entry. 채널 성과가 이전 기간도 함께 읽으므로 몇 개를 같이 들고 있는다.
const MAX_ENTRIES = 4;
const cache = new Map<string, CacheEntry>();

function freshEntry(key: string): CacheEntry | null {
  const e = cache.get(key);
  return e && e.expiresAt > Date.now() ? e : null;
}

export type LoadOptions = {
  from: string;
  until: string;
  force?: boolean;
};

async function loadRawData(opts: LoadOptions): Promise<CacheEntry> {
  const key = `${opts.from}|${opts.until}`;
  const now = Date.now();
  const hit = freshEntry(key);
  if (!opts.force && hit) {
    return hit;
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
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return entry;
}

export async function loadProfitSummary(opts: LoadOptions & {
  pgFeeRate?: number;
  reportCostPerUnit?: number;
}): Promise<{ summary: ProfitSummary; metaError: string | null; cached: boolean }> {
  const wasCached = !opts.force && freshEntry(`${opts.from}|${opts.until}`) !== null;
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
  const wasCached = !opts.force && freshEntry(`${opts.from}|${opts.until}`) !== null;
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
  cache.clear();
}

// ── 채널 성과 ─────────────────────────────────────────────────────────────
// 결제별 유입 귀속은 lib/mixpanel-store.ts 가 날짜별로 KV 에 저장해 재사용한다 (Mixpanel 쿼리 한도 보호).

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 같은 길이의 바로 앞 기간. */
export function previousRange(from: string, until: string): { from: string; until: string } {
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: shiftYmd(from, -days), until: shiftYmd(from, -1) };
}

// 결제 이벤트에 utm 이 실리기 시작한 날 (백엔드 purchase.utm_* 컬럼 추가일). 이전 기간은 집계하지 않는다.
export const CHANNEL_DATA_FROM = "2026-09-03";

function kstDate(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10) : "";
}

// profit.ts 와 같은 규칙: paidAt 이 파싱 안 되면 requestedAt.
const paymentDate = (p: PortonePayment) => kstDate(p.paidAt) || kstDate(p.requestedAt);

export async function loadChannelRevenue(opts: LoadOptions): Promise<{
  cur: ChannelPeriod | null;
  prev: ChannelPeriod | null;
  prevRange: { from: string; until: string } | null;
  clampedFrom: string | null;
  error: string | null;
  attributionAsOf: number | null;
  attributionStale: boolean;
}> {
  // 요청 기간이 데이터 시작일 이전을 포함하면 시작일부터만 본다.
  // 비교 기간이 시작일 앞을 걸치면 대부분 미귀속이 돼 증감이 거짓이 되므로 비교 기간도 생략.
  const clamped = opts.from < CHANNEL_DATA_FROM;
  const range = { from: clamped ? CHANNEL_DATA_FROM : opts.from, until: opts.until };
  if (range.from > range.until) {
    return { cur: null, prev: null, prevRange: null, clampedFrom: null, error: `채널 성과는 ${CHANNEL_DATA_FROM} 이후 기간만 볼 수 있습니다.`, attributionAsOf: null, attributionStale: false };
  }
  const prevCandidate = previousRange(opts.from, opts.until);
  const prevRange = clamped || prevCandidate.from < CHANNEL_DATA_FROM ? null : prevCandidate;

  // 대시보드와 같은 기간 키로 읽어 캐시를 공유하고, 잘린 경우만 날짜로 거른다.
  const [curRaw, prevRaw] = await Promise.all([
    loadRawData(opts),
    prevRange ? loadRawData({ ...prevRange, force: opts.force }) : Promise.resolve(null),
  ]);

  // 새로고침(force)은 토스·메타만 다시 받는다. Mixpanel 은 mixpanel-store 의 15분 규칙을 따른다.
  let stored: Awaited<ReturnType<typeof loadStoredAttributions>>;
  try {
    stored = await loadStoredAttributions(prevRange?.from ?? range.from, range.until);
  } catch (e: any) {
    const error = e instanceof MixpanelConfigError ? e.message : `Mixpanel 조회 실패: ${String(e?.message || e).slice(0, 200)}`;
    return { cur: null, prev: null, prevRange, clampedFrom: clamped ? range.from : null, error, attributionAsOf: null, attributionStale: false };
  }
  const byTx = new Map(stored.rows.map((a) => [a.tx, a]));
  const metaRowsAll = [...(prevRaw?.metaRows ?? []), ...curRaw.metaRows];
  const campaigns: CampaignRef[] = Array.from(
    new Map(metaRowsAll.map((r) => [r.campaignId, { id: r.campaignId, name: r.campaignName }])).values(),
  );
  const build = (raw: CacheEntry, r: { from: string; until: string }) =>
    buildChannelPeriod({
      payments: raw.payments.filter((p) => paymentDate(p) >= r.from),
      metaRows: raw.metaRows.filter((m) => m.date >= r.from),
      attributions: byTx,
      campaigns,
      range: r,
    });
  return {
    cur: build(curRaw, range),
    prev: prevRaw && prevRange ? build(prevRaw, prevRange) : null,
    prevRange,
    clampedFrom: clamped ? range.from : null,
    error: curRaw.metaError,
    attributionAsOf: stored.asOf,
    attributionStale: stored.stale,
  };
}
