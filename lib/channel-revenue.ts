/**
 * 채널별 매출·ROAS 집계 (순수 함수 — IO 없음).
 *
 * 토스 결제를 orderId(= Mixpanel transaction_id)로 귀속 재료와 잇고, 채널·캠페인별로 나눈 뒤
 * 각 묶음을 기존 computeProfit 에 그대로 넣는다. 매출·PG·AI 원가·공헌이익·손익분기 ROAS 의
 * 계산식은 lib/calc.ts 한 곳에만 있다 (README 규칙).
 *
 * 지표 정의 (2026-10-10 사장님 확정):
 *   MER                = 토스 전체 순매출 ÷ 광고비(메타 + 네이버, '시딩·브랜딩 포함'이면 + 시딩·브랜딩). 위 KPI 의 MER 과 같은 값
 *   메타 귀속 ROAS      = 메타 광고로 귀속된 순매출 ÷ 메타 광고비
 *   신규 고객 ROAS(aMER) = 메타 귀속 매출 중 첫 결제 고객분 ÷ 메타 광고비
 *   nCAC               = 메타 광고비 ÷ 메타 귀속 첫 결제 건수
 *   귀속률              = (전체 − 미귀속) 매출 ÷ 전체 매출
 *   메타 ROAS 범위       = 하한 귀속 ~ 상한 max(귀속, 픽셀) (단 MER 초과분은 자름, 2026-10-12 확정)
 *                          메타는 광고 본 뒤 검색·프로필로 들어와 산 매출도 자기 몫으로 잡아서, 둘 사이가 실제 효과.
 *                          픽셀은 광고 본 날에 매출을 붙여 최근 며칠은 덜 찬 값이라 하한으로 쓰지 않는다.
 */
import type { PortonePayment } from "./portone";
import { aggregateMetaByDay, type AdTagRef, type MetaInsightRow } from "./meta";
import { computeProfit } from "./profit";
import { calculateRoas } from "./calc";
import { AI_API_PAYMENTS, SERVER_COSTS, NAVER_AD_COSTS, marketingByDay, spreadByMonth } from "./manual-costs";
import {
  classifyChannel,
  CHANNEL_LABEL,
  type CampaignRef,
  type ChannelGroup,
  type PurchaseAttribution,
} from "./channel";
import { setNameOf } from "./sets";

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

/** 세트 판매 (전체 고객 기준). 매출·건수는 채널 표와 같은 computeProfit 순매출·결제 건수. */
export type SetSales = {
  rev: number;
  n: number;
  singleRev: number;          // 세트 아닌 결제 (단품·질문권)
  singleN: number;
  bySet: Array<{ name: string; rev: number; n: number }>;                 // 매출 큰 순
  byCampaign: Array<{ key: string; name: string; campaignId?: string; rev: number; n: number; totalRev: number; spend: number }>;
  daily: Array<{ date: string; rev: number; totalRev: number; n: Record<string, number>; singleN: number }>;
  buyers: number;             // 구매자 수 (Mixpanel 구매자 ID 기준 — 기록 없는 결제는 건마다 1명)
  setBuyers: number;          // 그중 세트를 1번 이상 산 사람
};

export type ChannelPeriod = {
  range: { from: string; until: string };
  revenue: number;
  payments: number;
  adSpend: number;
  mer: number | null;
  // 화면 '시딩·브랜딩' 스위치를 켰을 때 값 (광고비에 시딩·브랜딩 포함)
  adSpendWithMarketing: number;
  merWithMarketing: number | null;
  metaRoas: number | null;
  metaBreakEvenRoas: number;
  metaRoasLow: number | null;
  metaRoasHigh: number | null;
  newCustomerRoas: number | null;
  newCustomerCac: number | null;
  pixelRoas: number | null;
  coverage: number | null;
  restoredCount: number;
  unattributedCount: number;
  // 인플루언서 할인 링크 결제 중 결제 전 메타 광고 클릭이 있어 메타 캠페인에 넣은 것
  discountViaMeta: { n: number; rev: number };
  groups: ChannelGroupRow[];
  daily: ChannelDaily[];
  sets: SetSales;
};

type Tagged = {
  p: PortonePayment;
  group: ChannelGroup;
  detail: string;
  campaignId?: string;
  isNew: boolean;
  restored: boolean;
  set: string | null;
  user?: string;
  viaDiscount?: boolean;
};

type Range = { from: string; until: string };

function summarize(
  key: string, name: string, items: Tagged[], rows: MetaInsightRow[], range: Range, campaignId?: string,
  extraSpendByDay: Array<{ date: string; spend: number }> = [],
): ChannelRow {
  const all = computeProfit({ payments: items.map((t) => t.p), metaByDay: aggregateMetaByDay(rows), range, extraAdByDay: extraSpendByDay }).totals;
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

/**
 * 메타 행에서 캠페인 목록 — 최근에 집행한 캠페인이 앞. 수동 태그는 이름 키워드로 목록 앞쪽 캠페인을 고르므로,
 * 전체 기간을 보면 4월 '260424 연애운 랜딩페이지 수정' 이 지금 연애운 캠페인보다 먼저 잡혔다 (2026-10-19).
 */
export function campaignRefs(rows: MetaInsightRow[]): CampaignRef[] {
  // 최근 = 광고비를 쓴 마지막 날 (0원 행은 순서에 안 씀, 0원 행만 있는 캠페인은 맨 뒤). 같은 날이면 ID 큰(나중 만든) 캠페인 먼저.
  const latest = new Map<string, { ref: CampaignRef; date: string }>();
  for (const r of rows) {
    const cur = latest.get(r.campaignId) || { ref: { id: r.campaignId, name: r.campaignName }, date: "" };
    if (r.spend > 0 && r.date > cur.date) cur.date = r.date;
    latest.set(r.campaignId, cur);
  }
  return Array.from(latest.values())
    // ID 는 숫자 문자열 — 자릿수 먼저 비교해야 숫자 크기 순
    .sort((a, b) => b.date.localeCompare(a.date) || b.ref.id.length - a.ref.id.length || b.ref.id.localeCompare(a.ref.id))
    .map((x) => x.ref);
}

/** 메타 ROAS 범위. 하한은 실제 결제로 확인한 귀속, 상한은 메타 주장(회사 전체 매출 MER 을 넘을 수 없음). */
export function metaRoasRange(attributed: number | null, pixel: number | null, mer: number | null): { low: number | null; high: number | null } {
  if (attributed == null) return { low: null, high: null };
  const claim = pixel == null ? attributed : mer == null ? pixel : Math.min(pixel, mer);
  return { low: attributed, high: Math.max(attributed, claim) };
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
  adTags?: AdTagRef[];
  range: Range;
}): ChannelPeriod {
  const { payments, metaRows, attributions, campaigns, adTags = [], range } = args;

  const tagged: Tagged[] = payments.map((p) => {
    const a = p.orderId ? attributions.get(p.orderId) : undefined;
    const ch = classifyChannel(a, campaigns, adTags);
    return { p, ...ch, isNew: Boolean(a?.isNew), restored: a?.how === "touch", set: setNameOf(a?.rt, p.amount?.total), user: a?.user };
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
    // 네이버 검색광고비는 손으로 넣은 월 소진액 (lib/manual-costs.ts). 링크별 하위 행에는 안 나눈다.
    const extra = group === "search_ad" ? spreadByMonth(NAVER_AD_COSTS, range) : [];
    return { ...summarize(group, CHANNEL_LABEL[group], items, rows, range, undefined, extra), group, children: childRows };
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

  // 회사 전체는 위 KPI 와 같은 숫자가 되도록 네이버·API 결제액을 넣는다(시딩·브랜딩 포함본은 따로). 채널·캠페인 행에는 안 넣는다.
  const companyTotal = (withMarketing: boolean) => computeProfit({
    payments,
    metaByDay: aggregateMetaByDay(metaRows),
    range,
    extraAdByDay: [...spreadByMonth(NAVER_AD_COSTS, range), ...(withMarketing ? marketingByDay(range) : [])],
    extraReportCostByDay: [...spreadByMonth(AI_API_PAYMENTS, range), ...spreadByMonth(SERVER_COSTS, range)],
  }).totals;
  const total = companyTotal(false);
  const totalMk = companyTotal(true);
  const restored = computeProfit({ payments: tagged.filter((t) => t.restored).map((t) => t.p), metaByDay: [], range }).totals;
  const viaDiscount = computeProfit({ payments: tagged.filter((t) => t.viaDiscount).map((t) => t.p), metaByDay: [], range }).totals;
  const meta = groups[0];
  const unattributed = groups.find((g) => g.group === "unattributed")!;
  // 메타 주장 상한은 '전체 매출 ÷ 메타 광고비'로 자른다(시딩비를 넣은 MER 로 자르면 상한이 부당하게 낮아짐).
  const roasRange = metaRoasRange(meta.roas, meta.pixelRoas, calculateRoas(total.netRevenue, meta.spend));

  return {
    range,
    revenue: total.netRevenue,
    payments: total.reportCount,
    adSpend: total.adSpend,
    mer: total.roas,
    adSpendWithMarketing: totalMk.adSpend,
    merWithMarketing: totalMk.roas,
    metaRoas: meta.roas,
    metaBreakEvenRoas: meta.breakEvenRoas,
    metaRoasLow: roasRange.low,
    metaRoasHigh: roasRange.high,
    newCustomerRoas: calculateRoas(meta.newRev, meta.spend),
    newCustomerCac: meta.newN > 0 ? meta.spend / meta.newN : null,
    pixelRoas: meta.pixelRoas,
    coverage: total.netRevenue > 0 ? ((total.netRevenue - unattributed.rev) / total.netRevenue) * 100 : null,
    restoredCount: restored.reportCount,
    unattributedCount: unattributed.n,
    discountViaMeta: { n: viaDiscount.reportCount, rev: viaDiscount.netRevenue },
    groups,
    daily,
    sets: buildSetSales(tagged, meta.children, range),
  };
}

function buildSetSales(tagged: Tagged[], metaCampaigns: ChannelRow[], range: Range): SetSales {
  const sum = (items: Tagged[]) => computeProfit({ payments: items.map((t) => t.p), metaByDay: [], range });
  const sets = tagged.filter((t) => t.set);
  const all = sum(sets).totals;
  const single = sum(tagged.filter((t) => !t.set)).totals;

  // 구매자 기준: 같은 사람 결제를 묶어, 결제 건수로 세는 결제(취소 제외)가 있으면 1명.
  // Mixpanel 기록 없는 결제는 사람을 몰라 건마다 1명으로 센다 (세트 판정도 기록이 있어야 하므로 분모만 빠지면 비율이 부풀음).
  const byUser = new Map<string, Tagged[]>();
  for (const t of tagged) {
    if (!t.user) continue;
    const cur = byUser.get(t.user) || [];
    cur.push(t);
    byUser.set(t.user, cur);
  }
  const users = Array.from(byUser.values());
  const buyers = users.filter((items) => sum(items).totals.reportCount > 0).length + sum(tagged.filter((t) => !t.user)).totals.reportCount;
  const setBuyers = users.filter((items) => sum(items.filter((t) => t.set)).totals.reportCount > 0).length;

  const names = Array.from(new Set(sets.map((t) => t.set!)));
  const bySet = names
    .map((name) => {
      const r = sum(sets.filter((t) => t.set === name));
      return { name, rev: r.totals.netRevenue, n: r.totals.reportCount, daily: r.daily };
    })
    .sort((a, b) => b.rev - a.rev);

  // 캠페인 행 = 위 채널 표의 메타 캠페인 그대로 + 메타 외 채널 1줄 (같은 결제·같은 키로 묶어 두 표 숫자가 맞게)
  const metaSet = sets.filter((t) => t.group === "meta");
  const byCampaign = [
    ...metaCampaigns.map((c) => {
      const r = sum(metaSet.filter((t) => (t.campaignId || `meta:${t.detail}`) === c.key)).totals;
      return { key: c.key, name: c.name, campaignId: c.campaignId, rev: r.netRevenue, n: r.reportCount, totalRev: c.rev, spend: c.spend };
    }),
    (() => {
      const r = sum(sets.filter((t) => t.group !== "meta")).totals;
      const total = sum(tagged.filter((t) => t.group !== "meta")).totals;
      return { key: "other", name: "메타 외 채널", rev: r.netRevenue, n: r.reportCount, totalRev: total.netRevenue, spend: 0 };
    })(),
  ];

  const dayRev = (rows: Array<{ date: string; netRevenue: number }>) => new Map(rows.map((d) => [d.date, d.netRevenue]));
  const dayN = (rows: Array<{ date: string; reportCount: number }>) => new Map(rows.map((d) => [d.date, d.reportCount]));
  const setRev = dayRev(sum(sets).daily);
  const totRev = dayRev(sum(tagged).daily);
  const singleN = dayN(sum(tagged.filter((t) => !t.set)).daily);
  const nBySet = bySet.map((s) => [s.name, dayN(s.daily)] as const);
  const daily = ymdRange(range.from, range.until).map((date) => ({
    date,
    rev: setRev.get(date) || 0,
    totalRev: totRev.get(date) || 0,
    n: Object.fromEntries(nBySet.map(([name, m]) => [name, m.get(date) || 0])),
    singleN: singleN.get(date) || 0,
  }));

  return {
    rev: all.netRevenue,
    n: all.reportCount,
    singleRev: single.netRevenue,
    singleN: single.reportCount,
    bySet: bySet.map(({ name, rev, n }) => ({ name, rev, n })),
    byCampaign,
    buyers,
    setBuyers,
    daily,
  };
}
