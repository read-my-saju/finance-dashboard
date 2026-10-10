/**
 * 채널별 매출·ROAS 집계 (순수 함수 — IO 없음).
 *
 * 토스 결제를 orderId(= Mixpanel transaction_id)로 귀속 재료와 잇고, 채널·캠페인별로 나눈 뒤
 * 각 묶음을 기존 computeProfit 에 그대로 넣는다. 매출·PG·AI 원가·공헌이익·손익분기 ROAS 의
 * 계산식은 lib/calc.ts 한 곳에만 있다 (README 규칙).
 *
 * 지표 정의 (2026-10-10 사장님 확정):
 *   MER                = 토스 전체 순매출 ÷ 메타 광고비 (기존 대시보드 "ROAS" 와 같은 값)
 *   메타 귀속 ROAS      = 메타 광고로 귀속된 순매출 ÷ 메타 광고비
 *   신규 고객 ROAS(aMER) = 메타 귀속 매출 중 첫 결제 고객분 ÷ 메타 광고비
 *   nCAC               = 메타 광고비 ÷ 메타 귀속 첫 결제 건수
 *   귀속률              = (전체 − 미귀속) 매출 ÷ 전체 매출
 */
import type { PortonePayment } from "./portone";
import { aggregateMetaByDay, type MetaInsightRow } from "./meta";
import { computeProfit } from "./profit";
import { calculateRoas } from "./calc";
import {
  classifyChannel,
  CHANNEL_LABEL,
  type CampaignRef,
  type ChannelGroup,
  type PurchaseAttribution,
} from "./channel";

// meta 가 항상 0번 (groups[0] 을 메타로 씀). 순서는 화면 누적 막대 순서와 같다 (인접 색 대비 검증된 순서).
export const CHANNEL_ORDER: ChannelGroup[] = ["meta", "search", "search_ad", "owned", "influencer", "referral", "unattributed"];

export type ChannelRow = {
  key: string;
  name: string;
  campaignId?: string;
  rev: number;               // 순매출 (VAT 포함, 환불 반영)
  n: number;                 // 결제 건수
  newRev: number;            // 첫 결제 고객 매출
  newN: number;              // 첫 결제 건수 (= 신규 고객 수)
  spend: number;             // 메타 광고비 (KRW). 메타 외 채널은 0
  roas: number | null;       // rev ÷ spend
  pixelRoas: number | null;  // 메타 픽셀 매출 ÷ spend
  breakEvenRoas: number;
  contributionProfit: number;
};

export type ChannelGroupRow = ChannelRow & { group: ChannelGroup; children: ChannelRow[] };

export type ChannelDaily = {
  date: string;
  rev: Record<ChannelGroup, number>;
  newRev: Record<ChannelGroup, number>;
};

export type ChannelPeriod = {
  range: { from: string; until: string };
  revenue: number;
  payments: number;
  adSpend: number;
  mer: number | null;
  metaRoas: number | null;
  metaBreakEvenRoas: number;
  newCustomerRoas: number | null;
  newCustomerCac: number | null;
  pixelRoas: number | null;
  coverage: number | null;
  restoredCount: number;
  unattributedCount: number;
  groups: ChannelGroupRow[];
  daily: ChannelDaily[];
};

type Tagged = {
  p: PortonePayment;
  group: ChannelGroup;
  detail: string;
  campaignId?: string;
  isNew: boolean;
  restored: boolean;
};

type Range = { from: string; until: string };

function summarize(key: string, name: string, items: Tagged[], rows: MetaInsightRow[], range: Range, campaignId?: string): ChannelRow {
  const all = computeProfit({ payments: items.map((t) => t.p), metaByDay: aggregateMetaByDay(rows), range }).totals;
  const fresh = computeProfit({ payments: items.filter((t) => t.isNew).map((t) => t.p), metaByDay: [], range }).totals;
  const pixel = rows.reduce((s, r) => s + r.purchaseValue, 0);
  return {
    key,
    name,
    campaignId,
    rev: all.netRevenue,
    n: all.reportCount,
    newRev: fresh.netRevenue,
    newN: fresh.reportCount,
    spend: all.adSpend,
    roas: all.roas,
    pixelRoas: calculateRoas(pixel, all.adSpend),
    breakEvenRoas: all.breakEvenRoas,
    contributionProfit: all.contributionProfit,
  };
}

function ymdRange(from: string, until: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= until; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function emptyByGroup(): Record<ChannelGroup, number> {
  return { meta: 0, search: 0, search_ad: 0, owned: 0, influencer: 0, referral: 0, unattributed: 0 };
}

export function buildChannelPeriod(args: {
  payments: PortonePayment[];
  metaRows: MetaInsightRow[];
  attributions: Map<string, PurchaseAttribution>;
  campaigns: CampaignRef[];
  range: Range;
}): ChannelPeriod {
  const { payments, metaRows, attributions, campaigns, range } = args;

  const tagged: Tagged[] = payments.map((p) => {
    const a = p.orderId ? attributions.get(p.orderId) : undefined;
    const ch = classifyChannel(a, campaigns);
    return { p, ...ch, isNew: Boolean(a?.isNew), restored: a?.how === "touch" };
  });

  const groups: ChannelGroupRow[] = CHANNEL_ORDER.map((group) => {
    const items = tagged.filter((t) => t.group === group);
    const rows = group === "meta" ? metaRows : [];
    const children = new Map<string, { name: string; campaignId?: string; items: Tagged[] }>();
    for (const t of items) {
      const key = t.campaignId || `${group}:${t.detail}`;
      const cur = children.get(key) || { name: t.detail, campaignId: t.campaignId, items: [] };
      cur.items.push(t);
      children.set(key, cur);
    }
    // 광고비는 썼는데 귀속 결제가 0건인 캠페인도 표에 남긴다.
    if (group === "meta") {
      for (const r of metaRows) {
        if (r.spend > 0 && !children.has(r.campaignId)) children.set(r.campaignId, { name: r.campaignName, campaignId: r.campaignId, items: [] });
      }
    }
    const childRows = Array.from(children.entries())
      .map(([key, c]) => summarize(key, c.name, c.items, c.campaignId ? metaRows.filter((r) => r.campaignId === c.campaignId) : [], range, c.campaignId))
      .sort((a, b) => b.rev - a.rev || b.spend - a.spend);
    return { ...summarize(group, CHANNEL_LABEL[group], items, rows, range), group, children: childRows };
  });

  const dailyByGroup = new Map<ChannelGroup, { all: Map<string, number>; fresh: Map<string, number> }>();
  for (const group of CHANNEL_ORDER) {
    const items = tagged.filter((t) => t.group === group);
    const toMap = (ps: PortonePayment[]) =>
      new Map(computeProfit({ payments: ps, metaByDay: [], range }).daily.map((d) => [d.date, d.netRevenue]));
    dailyByGroup.set(group, { all: toMap(items.map((t) => t.p)), fresh: toMap(items.filter((t) => t.isNew).map((t) => t.p)) });
  }
  const daily: ChannelDaily[] = ymdRange(range.from, range.until).map((date) => {
    const rev = emptyByGroup();
    const newRev = emptyByGroup();
    for (const group of CHANNEL_ORDER) {
      rev[group] = dailyByGroup.get(group)!.all.get(date) || 0;
      newRev[group] = dailyByGroup.get(group)!.fresh.get(date) || 0;
    }
    return { date, rev, newRev };
  });

  const total = computeProfit({ payments, metaByDay: aggregateMetaByDay(metaRows), range }).totals;
  const restored = computeProfit({ payments: tagged.filter((t) => t.restored).map((t) => t.p), metaByDay: [], range }).totals;
  const meta = groups[0];
  const unattributed = groups.find((g) => g.group === "unattributed")!;

  return {
    range,
    revenue: total.netRevenue,
    payments: total.reportCount,
    adSpend: total.adSpend,
    mer: total.roas,
    metaRoas: meta.roas,
    metaBreakEvenRoas: meta.breakEvenRoas,
    newCustomerRoas: calculateRoas(meta.newRev, meta.spend),
    newCustomerCac: meta.newN > 0 ? meta.spend / meta.newN : null,
    pixelRoas: meta.pixelRoas,
    coverage: total.netRevenue > 0 ? ((total.netRevenue - unattributed.rev) / total.netRevenue) * 100 : null,
    restoredCount: restored.reportCount,
    unattributedCount: unattributed.n,
    groups,
    daily,
  };
}
