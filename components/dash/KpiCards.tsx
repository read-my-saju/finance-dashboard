import { fmtMan } from "@/lib/dashboard-view";
import { CARD, TXT } from "./ui";

// Dashboard.tsx 의 ProfitTotals, PrevTotals, AdBreakdown, DailyRow 중 이 화면이 쓰는 필드만.
type Totals = {
  netRevenue: number; revenueExVat: number; pgFee: number; reportCost: number; adSpend: number;
  contributionProfit: number; contributionMargin: number | null; roas: number | null; reportCount: number;
};
type Prev = { days: number; netRevenue: number; adSpend: number; pgFee: number; reportCost: number; contributionProfit: number };
type Ad = { meta: number; naver: number; seeding: number; branding: number; server?: number; marketingIncluded: boolean };
export type KpiDailyRow = { date: string; netRevenue: number; adSpend: number; pgFee: number; reportCost: number; contributionProfit: number };

const GOOD = "text-[#15803d] dark:text-[#3fb950]";
const BAD = "text-[#dc2626] dark:text-[#f07070]";

function pct(cur: number, base: number): number | null {
  return base === 0 ? null : ((cur - base) / Math.abs(base)) * 100;
}

function Delta({ v, tone, suffix, unit = "%" }: { v: number | null; tone: "gray" | "color"; suffix: string; unit?: string }) {
  if (v === null) return <span className={TXT.dim}>—</span>;
  const cls = tone === "gray" ? TXT.sub : v >= 0 ? GOOD : BAD;
  return (
    <span>
      <span className={`font-semibold tabular-nums ${cls}`}>{v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}{unit}</span>
      <span className={`hidden sm:inline ${TXT.dim}`}> {suffix}</span>
    </span>
  );
}

// 휴대폰 2열에서 카드마다 줄 구성을 같게: 이름, 큰 숫자, 비교, 보조(한 줄 말줄임) 4줄 고정. 카드 높이는 같은 행끼리 그리드가 맞춘다.
function Card({ label, value, compare, sub, accent, footer }: { label: string; value: string; compare: React.ReactNode; sub: string; accent?: boolean; footer?: React.ReactNode }) {
  return (
    <div className={`${CARD} min-w-0 !p-4 ${accent ? "!border-[#15803d]/50 dark:!border-[#3fb950]/50" : ""}`}>
      <div className={`text-[13px] font-medium leading-4 md:text-xs ${TXT.sub}`}>{label}</div>
      <div className={`mt-1 break-words text-2xl font-extrabold tabular-nums tracking-tight ${TXT.main}`}>{value}</div>
      <div className="mt-2 truncate text-xs leading-4 md:overflow-visible md:whitespace-normal">{compare}</div>
      <div title={sub} className={`mt-1 min-h-4 truncate text-xs leading-4 md:overflow-visible md:whitespace-normal ${TXT.dim}`}>{sub}</div>
      {footer}
    </div>
  );
}

function adSub(ab: Ad | undefined): string {
  if (!ab) return "";
  const parts = [`메타 ${fmtMan(ab.meta)}`, `네이버 ${fmtMan(ab.naver)}`];
  if (ab.marketingIncluded) parts.push(`시딩 ${fmtMan(ab.seeding)}`, `브랜딩 ${fmtMan(ab.branding)}`);
  return parts.join(", ");
}

export default function KpiCards({ totals, prev, adBreakdown, daily, live, stale, yesterdaySameTime, prevDays, marketingSwitch }: {
  totals?: Totals; prev: Prev | null; adBreakdown?: Ad; daily: KpiDailyRow[];
  live: boolean; stale?: boolean; yesterdaySameTime: number | null; prevDays: number; marketingSwitch?: React.ReactNode;
}) {
  const t = totals;
  const vsText = `이전 ${prevDays}일 대비`;
  const rows = daily.filter((d) => d.date < new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));

  // 증감 = 직전 동기간 일평균 대비. 완료된 날만 센다(당일 제외).
  function delta(getCur: (d: KpiDailyRow) => number, getPrev: (p: Prev) => number): number | null {
    if (!prev || prev.days <= 0 || rows.length === 0) return null;
    return pct(rows.reduce((a, d) => a + getCur(d), 0) / rows.length, getPrev(prev) / prev.days);
  }
  const ago = (v: number | null, tone: "gray" | "color") =>
    live ? <span className={TXT.dim}>진행 중</span> : <Delta v={v} tone={tone} suffix={vsText} />;

  const merDelta = (() => {
    if (!prev || rows.length === 0) return null;
    const ad = rows.reduce((a, d) => a + d.adSpend, 0);
    const prevAd = prev.adSpend;
    if (ad <= 0 || prevAd <= 0) return null;
    return (rows.reduce((a, d) => a + d.netRevenue, 0) / ad - prev.netRevenue / prevAd) * 100; // %p 차이
  })();

  const revenue = t?.netRevenue ?? 0;
  const mm = (n: number | undefined) => (t ? fmtMan(n ?? 0) : "—");
  const revenueCompare = live
    ? yesterdaySameTime ? <Delta v={pct(revenue, yesterdaySameTime)} tone="color" suffix={`어제 이 시각 ${fmtMan(yesterdaySameTime)}`} /> : <span className={TXT.dim}>—</span>
    : <Delta v={delta((d) => d.netRevenue, (p) => p.netRevenue)} tone="color" suffix={vsText} />;
  const perReport = t && t.reportCount > 0 ? Math.round(t.reportCost / t.reportCount) : null;
  const feeRate = t && t.netRevenue > 0 ? (t.pgFee / t.netRevenue) * 100 : null;

  return (
    <div className={`grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 sm:gap-4 xl:grid-cols-6 ${stale ? "opacity-60" : ""}`}>
      <Card
        label="결제매출" value={mm(revenue)} compare={revenueCompare}
        sub={t ? `부가세 제외 ${fmtMan(t.revenueExVat)}, 결제 ${t.reportCount.toLocaleString("en-US")}건` : "—"}
      />
      <Card label="광고비" value={mm(t?.adSpend)} compare={ago(delta((d) => d.adSpend, (p) => p.adSpend), "gray")} sub={adSub(adBreakdown)} footer={marketingSwitch} />
      <Card
        label="결제수수료" value={mm(t?.pgFee)} compare={ago(delta((d) => d.pgFee, (p) => p.pgFee), "gray")}
        sub={feeRate === null ? "매출의 —" : `매출의 ${feeRate.toFixed(1)}%`}
      />
      <Card
        label="리포트 원가" value={mm(t?.reportCost)} compare={ago(delta((d) => d.reportCost, (p) => p.reportCost), "gray")}
        sub={`${perReport === null ? "결제 1건당 —" : `결제 1건당 ${perReport.toLocaleString("en-US")}원`}${adBreakdown?.server ? ", 서버비 포함" : ""}`}
      />
      <Card
        label="MER" value={t?.roas == null ? "—" : `${t.roas.toFixed(1)}%`}
        compare={live ? <span className={TXT.dim}>진행 중이라 판정 안 함</span> : <Delta v={merDelta} tone="color" suffix={vsText} unit="%p" />}
        sub="전체 매출 ÷ 광고비"
      />
      <Card
        label="공헌이익" value={mm(t?.contributionProfit)} compare={ago(delta((d) => d.contributionProfit, (p) => p.contributionProfit), "color")}
        sub={`마진 ${t?.contributionMargin == null ? "—" : `${t.contributionMargin.toFixed(1)}%`}`} accent
      />
    </div>
  );
}
