"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BREAK_EVEN_ROAS_FALLBACK, calculateBreakEvenRoas, calculateRoas } from "@/lib/calc";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type PaymentsData = {
  range: { from: string; until: string };
  fetchedAt: string;
  gross: number;
  netRevenue: number;
  cancelled: number;
  paidCount: number;
  cancelCount: number;
  byChannel: Array<{ label: string; gross: number; net: number; count: number; pct: number }>;
  daily: Array<{ date: string; gross: number }>;
  weekly: Array<{ weekStart: string; gross: number }>;
  hourly?: Array<{ hour: number; amount: number; count: number }>;
  cached?: boolean;
};

type ProfitTotals = {
  netRevenue: number;
  vat: number;
  revenueExVat: number;
  pgFee: number;
  reportCost: number;
  reportCostRate: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  breakEvenRoas: number;
  status: "흑자" | "손익분기" | "적자";
  adAdvice: "증액 가능" | "광고비 주의" | "광고비 없음";
  reportCount: number;
  cancelledAmount: number;
};

type SummaryData = {
  range: { from: string; until: string };
  fetchedAt: string;
  settings: { pgFeeRate: number; reportCostPerUnit: number };
  totals: ProfitTotals;
  metaError: string | null;
  cached?: boolean;
};

type DailyRow = {
  date: string;
  netRevenue: number;
  vat: number;
  revenueExVat: number;
  pgFee: number;
  reportCost: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  breakEvenRoas: number;
  reportCount: number;
  cancelledAmount: number;
};

type DailyData = {
  range: { from: string; until: string };
  fetchedAt: string;
  daily: DailyRow[];
  metaError: string | null;
  cached?: boolean;
};

type CampaignRow = {
  campaignId: string;
  campaignName: string;
  purchases: number;
  cpa: number | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spend: number;
  roas: number | null;
  ctr: number | null;
  frequency: number | null;
  cvr: number | null;
  cpm: number | null;
};

type CampaignsData = {
  range: { from: string; until: string };
  fetchedAt: string;
  campaigns: CampaignRow[];
  metaError: string | null;
  cached?: boolean;
};

// 직전 동기간 합계 (KPI 증감 비교용)
type PrevTotals = {
  days: number;
  netRevenue: number;
  adSpend: number;
  pgFee: number;
  reportCost: number;
  contributionProfit: number;
};

// ────────────────────────────────────────────────────────────────────────────
// Theme (다크모드)
// ────────────────────────────────────────────────────────────────────────────

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  // 초기값은 layout.tsx 인라인 스크립트가 심어 둔 html.dark 를 따른다.
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("rmsf_theme", next);
      } catch {}
      return next;
    });
  }, []);
  return [theme, toggle];
}

// Recharts 는 SVG 속성에 hex 를 직접 받으므로 테마별 팔레트 객체로 공급.
type ChartPalette = {
  grid: string;
  axis: string;
  refline: string;
  barNet: string;
  barRevenue: string;
  barAd: string;
  roas: string;
  profit: string;
  today: string;
  bep: string;
  spark: string;
  hourly: string;
  costSegments: [string, string, string, string]; // 광고비 · VAT · PG수수료 · 리포트원가
  tooltipBg: string;
  tooltipBorder: string;
  tooltipLabel: string;
};

const LIGHT_PAL: ChartPalette = {
  grid: "#f3f4f6",
  axis: "#9ca3af",
  refline: "#9ca3af",
  barNet: "#e5e7eb",
  barRevenue: "#3b82f6",
  barAd: "#22c55e",
  roas: "#8b5cf6",
  profit: "#0f766e",
  today: "#9ca3af",
  bep: "#fb7185",
  spark: "#FF6F0F",
  hourly: "#FF6F0F",
  costSegments: ["#f97316", "#a78bfa", "#fbbf24", "#94a3b8"],
  tooltipBg: "#ffffff",
  tooltipBorder: "#e5e7eb",
  tooltipLabel: "#6b7280",
};

const DARK_PAL: ChartPalette = {
  grid: "#27272a",
  axis: "#71717a",
  refline: "#71717a",
  barNet: "#3f3f46",
  barRevenue: "#60a5fa",
  barAd: "#4ade80",
  roas: "#a78bfa",
  profit: "#2dd4bf",
  today: "#71717a",
  bep: "#fb7185",
  spark: "#FF8534",
  hourly: "#FF8534",
  costSegments: ["#fb923c", "#c4b5fd", "#fcd34d", "#a1a1aa"],
  tooltipBg: "#18181b",
  tooltipBorder: "#3f3f46",
  tooltipLabel: "#a1a1aa",
};

function tooltipStyle(pal: ChartPalette) {
  return {
    contentStyle: {
      borderRadius: 8,
      border: `1px solid ${pal.tooltipBorder}`,
      background: pal.tooltipBg,
    },
    labelStyle: { color: pal.tooltipLabel, fontSize: 12 },
    itemStyle: { fontSize: 12 },
  } as const;
}

// ────────────────────────────────────────────────────────────────────────────
// Formatters / helpers
// ────────────────────────────────────────────────────────────────────────────

const NUM = new Intl.NumberFormat("ko-KR");

function todayStr(): string {
  const d = new Date();
  return ymd(d);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function diffDays(from: string, until: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(until + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000) + 1;
}
function fmtKrw(n: number): string {
  return `₩${NUM.format(Math.round(n))}`;
}
function fmtKrwShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}
function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
function pctChange(prev: number, cur: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// 62일 초과 범위는 월 단위로 묶어 차트 가독성 확보.
const MONTHLY_THRESHOLD = 62;

type MonthlyRow = {
  month: string; // YYYY-MM
  netRevenue: number;
  adSpend: number;
  vat: number;
  pgFee: number;
  reportCost: number;
  contributionProfit: number;
  roas: number | null;
};

function bucketMonthly(rows: DailyRow[]): MonthlyRow[] {
  const map = new Map<string, Omit<MonthlyRow, "month" | "roas">>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    const m = map.get(key) || { netRevenue: 0, adSpend: 0, vat: 0, pgFee: 0, reportCost: 0, contributionProfit: 0 };
    m.netRevenue += r.netRevenue;
    m.adSpend += r.adSpend;
    m.vat += r.vat;
    m.pgFee += r.pgFee;
    m.reportCost += r.reportCost;
    m.contributionProfit += r.contributionProfit;
    map.set(key, m);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => ({ month, ...m, roas: calculateRoas(m.netRevenue, m.adSpend) }));
}

function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard root
// ────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [from, setFrom] = useState<string>(() => "2026-01-01");
  const [until, setUntil] = useState<string>(() => todayStr());
  const [payments, setPayments] = useState<PaymentsData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [daily, setDaily] = useState<DailyData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null);
  const [prevTotals, setPrevTotals] = useState<PrevTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const pal = theme === "dark" ? DARK_PAL : LIGHT_PAL;
  const monthly = useMemo(() => bucketMonthly(daily?.daily ?? []), [daily]);

  // 동시 진행 fetch 들 중 가장 최신 호출의 응답만 화면에 반영하기 위한 request id.
  // 사용자가 "전체 기간" → "오늘" 같이 빠르게 다른 범위를 누르면, PortOne cursor
  // 페이지네이션이 느려 전체 기간 fetch 가 늦게 끝나면서 오늘 응답을 덮어쓰는
  // race condition 이 있었음. 각 load 호출에 id 를 매기고, 응답이 도착했을 때
  // 더 새로운 호출이 있었으면 그 응답을 폐기.
  const reqIdRef = useRef(0);

  const load = useCallback(async (force = false) => {
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, until });
    if (force) qs.set("force", "1");
    const q = qs.toString();

    // 직전 동기간: 선택 범위 바로 앞의 같은 길이 구간 (KPI 증감 비교용).
    const len = diffDays(from, until);
    const prevUntil = addDays(from, -1);
    const prevFrom = addDays(prevUntil, -(len - 1));
    const prevQs = new URLSearchParams({ from: prevFrom, until: prevUntil });
    if (force) prevQs.set("force", "1");

    try {
      const [pRes, sRes, dRes, cRes, prevRes] = await Promise.all([
        fetch(`/api/payments?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/summary?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/daily?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/meta-campaigns?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/daily?${prevQs.toString()}`, { cache: "no-store" }),
      ]);
      if (reqIdRef.current !== myId) return;
      const [pJson, sJson, dJson, cJson, prevJson] = await Promise.all([
        pRes.json(), sRes.json(), dRes.json(), cRes.json(), prevRes.json(),
      ]);
      if (reqIdRef.current !== myId) return;
      if (!pRes.ok) {
        setError(pJson?.detail || pJson?.error || `payments HTTP ${pRes.status}`);
      } else {
        setPayments(pJson);
      }
      if (sRes.ok) setSummary(sJson);
      if (dRes.ok) setDaily(dJson);
      if (cRes.ok) setCampaigns(cJson);
      if (prevRes.ok && Array.isArray(prevJson?.daily)) {
        const rows: DailyRow[] = prevJson.daily;
        setPrevTotals({
          days: len,
          netRevenue: rows.reduce((a, r) => a + r.netRevenue, 0),
          adSpend: rows.reduce((a, r) => a + r.adSpend, 0),
          pgFee: rows.reduce((a, r) => a + r.pgFee, 0),
          reportCost: rows.reduce((a, r) => a + r.reportCost, 0),
          contributionProfit: rows.reduce((a, r) => a + r.contributionProfit, 0),
        });
      } else {
        setPrevTotals(null);
      }
    } catch (e: any) {
      if (reqIdRef.current !== myId) return;
      setError(String(e?.message || e));
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [from, until]);

  useEffect(() => {
    load(false);
    // unmount / 다음 load 시작 시 stale 응답을 모두 폐기.
    return () => { reqIdRef.current++; };
  }, [load]);

  // 화면 순매출 = PortOne 콘솔 순거래액 = payments.netRevenue (단일 진실)
  // summary.totals.netRevenue 도 같은 값이지만 위 값을 우선 사용해 UI 동기화 보장.
  const sourceNetRevenue = payments?.netRevenue ?? summary?.totals.netRevenue ?? 0;

  const metaError = summary?.metaError || daily?.metaError || campaigns?.metaError || null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Header
        fetchedAt={payments?.fetchedAt}
        cached={Boolean(payments?.cached && summary?.cached && daily?.cached)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <FilterBar
        from={from} until={until}
        setFrom={setFrom} setUntil={setUntil}
        loading={loading}
        onRefresh={() => load(true)}
        onLogout={async () => {
          await fetch("/api/auth", { method: "DELETE" });
          location.href = "/login";
        }}
      />

      {error && (
        <Banner tone="error" title="데이터 로드 실패" body={error} />
      )}
      {metaError && (
        <Banner tone="warn" title="광고 데이터 알림" body={metaError} />
      )}

      {/* ── 1. 상단 KPI 스트립 ─────────────────────────────────────────── */}
      <KpiStrip
        totals={summary?.totals}
        sourceNetRevenue={sourceNetRevenue}
        daily={daily?.daily ?? []}
        prev={prevTotals}
        pal={pal}
      />

      {/* ── 2. 순매출 vs 광고비 + 기간 요약 ─────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="일별 손익"
            badge={daily
              ? daily.daily.length > MONTHLY_THRESHOLD
                ? `${daily.daily.length}일 · 월별 표시`
                : `${daily.daily.length}일`
              : "—"}
          />
          <DailyProfitChart rows={daily?.daily ?? []} pal={pal} />
        </Card>
        <Card>
          <CardHeader title="기간 요약" badge={`${from} ~ ${until}`} />
          <PeriodSummaryCard totals={summary?.totals} daily={daily?.daily ?? []} sourceNetRevenue={sourceNetRevenue} />
        </Card>
      </div>

      {/* ── 2.5. 월별 추이 (31일 초과 범위) ─────────────────────────────── */}
      {monthly.length >= 2 && (daily?.daily.length ?? 0) > 31 && (
        <div className="mt-4">
          <Card>
            <CardHeader title="월별 매출 · 광고비 · ROAS 추이" badge={`${monthly.length}개월`} />
            <MonthlyTrendChart monthly={monthly} pal={pal} />
          </Card>
        </div>
      )}

      {/* ── 3. ROAS · 비용 구조 · 인사이트 ──────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="ROAS vs 손익분기 ROAS"
            badge="원가구조 BEP · 결제매출 기준"
          />
          <RoasChart rows={daily?.daily ?? []} pal={pal} />
        </Card>
        <Card>
          <CardHeader title="비용 구조" />
          <CostStructureBar totals={summary?.totals} pal={pal} />
        </Card>
        <Card>
          <CardHeader title="인사이트" />
          <InsightPanel
            totals={summary?.totals}
            daily={daily?.daily ?? []}
            sourceNetRevenue={sourceNetRevenue}
            settings={summary?.settings}
          />
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="시간대별 결제 분포" badge="KST · 선택 기간 합산" />
          <HourlyChart hourly={payments?.hourly ?? []} pal={pal} />
        </Card>
      </div>

      {/* ── 4. 하단 상세 (접기 가능) ────────────────────────────────────── */}
      <div className="mt-8 space-y-4">
        <Card>
          <CardHeader title="캠페인 TOP 10" badge="지출액 기준" />
          <CampaignTop10 campaigns={campaigns?.campaigns ?? []} bep={summary?.totals.breakEvenRoas ?? BREAK_EVEN_ROAS_FALLBACK} />
        </Card>

        <CollapsibleCard title="일별 손익 표" defaultOpen={false}>
          <DailyTable rows={daily?.daily ?? []} loading={loading} />
        </CollapsibleCard>

        <CollapsibleCard
          title="Meta 캠페인 (광고비 큰 순)"
          subtitle={campaigns ? `${campaigns.campaigns.length}개 캠페인` : undefined}
          defaultOpen={false}
        >
          <CampaignTable campaigns={campaigns?.campaigns ?? []} loading={loading} error={campaigns?.metaError ?? null} />
        </CollapsibleCard>

        <CollapsibleCard title="결제수단별 순거래액 TOP5" defaultOpen={false}>
          <ChannelTopList channels={payments?.byChannel.slice(0, 5) ?? []} />
        </CollapsibleCard>
      </div>

      <p className="mt-8 text-xs text-gray-400 dark:text-zinc-500">
        데이터 출처: PortOne V2 API · Meta Marketing API · Google Play 인앱결제는 본 대시보드에 포함되지 않음
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout pieces
// ────────────────────────────────────────────────────────────────────────────

function Header({
  fetchedAt, cached, theme, onToggleTheme,
}: { fetchedAt?: string; cached?: boolean; theme: Theme; onToggleTheme: () => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-zinc-100 sm:text-xl">결제 · 광고 손익 대시보드</h1>
        <p className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">Read My Saju · PortOne × Meta</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
        {fetchedAt && <span>업데이트 {new Date(fetchedAt).toLocaleString("ko-KR")}</span>}
        {cached && <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-zinc-800">cached</span>}
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {theme === "dark" ? (
            <svg className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

const filterBtnCls = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

function FilterBar({
  from, until, setFrom, setUntil, loading, onRefresh, onLogout,
}: {
  from: string; until: string;
  setFrom: (s: string) => void; setUntil: (s: string) => void;
  loading: boolean; onRefresh: () => void; onLogout: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <span className="text-gray-500 dark:text-zinc-400">시작</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent outline-none dark:text-zinc-200" />
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <span className="text-gray-500 dark:text-zinc-400">종료</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="bg-transparent outline-none dark:text-zinc-200" />
      </div>
      <button type="button" onClick={() => { setFrom(todayStr()); setUntil(todayStr()); }} className={filterBtnCls}>오늘</button>
      <button type="button" onClick={() => { setFrom(daysAgo(1)); setUntil(daysAgo(1)); }} className={filterBtnCls}>어제</button>
      <button type="button" onClick={() => { setFrom("2026-01-01"); setUntil(todayStr()); }} className={filterBtnCls}>전체 기간</button>
      <button type="button" onClick={() => { setFrom(daysAgo(29)); setUntil(todayStr()); }} className={filterBtnCls}>최근 30일</button>
      <button type="button" onClick={() => { setFrom(daysAgo(6)); setUntil(todayStr()); }} className={filterBtnCls}>최근 7일</button>
      <div className="grow" />
      <button type="button" onClick={onRefresh} disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-portone px-4 py-2 text-sm font-medium text-white hover:bg-portone-600 disabled:opacity-50">
        <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
        </svg>
        {loading ? "불러오는 중…" : "새로고침"}
      </button>
      <button type="button" onClick={onLogout}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800">로그아웃</button>
    </div>
  );
}

function Banner({ tone, title, body }: { tone: "error" | "warn"; title: string; body: string }) {
  const cls = tone === "error"
    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div className="font-medium">{title}</div>
      <div className={`mt-1 ${tone === "error" ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}>{body}</div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{title}</h3>
      {badge && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">{badge}</span>}
    </div>
  );
}

function CollapsibleCard({
  title, subtitle, defaultOpen, children,
}: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-gray-200 bg-white transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-gray-900 dark:text-zinc-100">
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {subtitle && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">{subtitle}</span>}
        </div>
        <svg className="h-4 w-4 text-gray-400 transition group-open:rotate-180 dark:text-zinc-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="border-t border-gray-100 px-5 py-4 dark:border-zinc-800">{children}</div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 1. KPI Strip — 6 cards
// ────────────────────────────────────────────────────────────────────────────

function KpiStrip({
  totals, sourceNetRevenue, daily, prev, pal,
}: {
  totals?: ProfitTotals;
  sourceNetRevenue: number;
  daily: DailyRow[];
  prev: PrevTotals | null;
  pal: ChartPalette;
}) {
  const finishedDaily = useMemo(() => {
    const today = todayStr();
    return daily.filter((d) => d.date < today);
  }, [daily]);

  // 증감 = 직전 동기간(같은 길이의 바로 앞 구간) 대비 일평균 비교.
  // 당일(미완료)은 현재 구간 합계에서 제외하고, 완료된 일수 기준 평균으로 맞춘다.
  function delta(getCur: (d: DailyRow) => number, getPrev: (p: PrevTotals) => number): number | null {
    if (!prev || prev.days <= 0 || finishedDaily.length === 0) return null;
    const curSum = finishedDaily.reduce((a, d) => a + getCur(d), 0);
    const curAvg = curSum / finishedDaily.length;
    const prevAvg = getPrev(prev) / prev.days;
    return pctChange(prevAvg, curAvg);
  }

  const netDelta = delta((d) => d.netRevenue, (p) => p.netRevenue);
  const adDelta = delta((d) => d.adSpend, (p) => p.adSpend);
  const pgDelta = delta((d) => d.pgFee, (p) => p.pgFee);
  const reportDelta = delta((d) => d.reportCost, (p) => p.reportCost);
  const profitDelta = delta((d) => d.contributionProfit, (p) => p.contributionProfit);

  // VAT 제외 매출 (첫 카드 서브표기용) — 결제매출 × 10/11 동등.
  const revenueExVat = sourceNetRevenue - sourceNetRevenue / 11;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="VAT 포함 결제매출"
        value={sourceNetRevenue}
        delta={netDelta}
        sparkData={finishedDaily.map((d) => d.netRevenue)}
        subText={`VAT 제외 ${fmtKrw(revenueExVat)}`}
        pal={pal}
      />
      <KpiCard
        label="광고비"
        value={totals?.adSpend ?? 0}
        delta={adDelta}
        deltaInverse
        sparkData={finishedDaily.map((d) => d.adSpend)}
        pal={pal}
      />
      <KpiCard
        label="결제수수료 (PG)"
        value={totals?.pgFee ?? 0}
        delta={pgDelta}
        deltaInverse
        sparkData={finishedDaily.map((d) => d.pgFee)}
        pal={pal}
      />
      <KpiCard
        label="리포트 생성원가"
        value={totals?.reportCost ?? 0}
        delta={reportDelta}
        deltaInverse
        sparkData={finishedDaily.map((d) => d.reportCost)}
        pal={pal}
      />
      <RoasKpiCard totals={totals} />
      <ProfitKpiCard totals={totals} delta={profitDelta} />
    </div>
  );
}

function DeltaBadge({ delta, deltaInverse }: { delta: number | null; deltaInverse?: boolean }) {
  const positive = delta !== null && delta >= 0;
  const goodColor = deltaInverse ? !positive : positive;
  const pillCls = delta === null
    ? "bg-gray-100 text-gray-400 dark:bg-zinc-800 dark:text-zinc-500"
    : goodColor
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400";
  return (
    <div className="flex items-center gap-1.5" title="직전 동기간(같은 길이의 바로 앞 구간) 일평균 대비">
      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${pillCls}`}>
        {delta === null ? "—" : `${positive ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%`}
      </span>
      <span className="text-[10px] font-normal text-gray-400 dark:text-zinc-500">vs 이전 기간</span>
    </div>
  );
}

function KpiCard({
  label, value, delta, deltaInverse, sparkData, subText, pal,
}: {
  label: string;
  value: number;
  delta: number | null;
  deltaInverse?: boolean;        // 광고비/수수료처럼 "줄어드는 게 좋은" 지표는 색 반전
  sparkData: number[];
  subText?: string;
  pal: ChartPalette;
}) {
  const sparkPoints = sparkData.map((v, i) => ({ x: i, y: v }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="text-xs font-medium text-gray-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-zinc-100">
        {fmtKrw(value)}
      </div>
      {subText && (
        <div className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">{subText}</div>
      )}
      <div className="mt-2.5 flex items-center justify-between">
        <DeltaBadge delta={delta} deltaInverse={deltaInverse} />
        <div className="h-6 w-20">
          {sparkData.length >= 2 && (
            <ResponsiveContainer>
              <LineChart data={sparkPoints}>
                <Line type="monotone" dataKey="y" stroke={pal.spark} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function RoasKpiCard({ totals }: { totals?: ProfitTotals }) {
  const roas = totals?.roas ?? null;
  const bep = totals?.breakEvenRoas ?? 118;
  const diff = roas !== null ? roas - bep : null;
  const above = diff !== null && diff > 0;
  const advice = totals?.adAdvice ?? "—";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="text-xs font-medium text-gray-500 dark:text-zinc-400">ROAS</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-zinc-100">
        {fmtPct(roas, 1)}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">
        포트원 결제매출(VAT 포함) ÷ 광고비 · 손익분기 {fmtPct(bep, 1)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`min-w-0 flex-1 text-xs font-medium ${
          diff === null ? "text-gray-400 dark:text-zinc-500" : above ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
        }`}>
          {`BEP ${bep.toFixed(0)}% 대비 ${diff !== null ? (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%p" : "—"}`}
        </span>
        <span className={`shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
          advice === "증액 가능" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
          : advice === "광고비 주의" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
          : "border-gray-200 bg-gray-50 text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        }`}>{advice}</span>
      </div>
    </div>
  );
}

function ProfitKpiCard({ totals, delta }: { totals?: ProfitTotals; delta: number | null }) {
  const cp = totals?.contributionProfit ?? 0;
  const margin = totals?.contributionMargin ?? null;
  const status = totals?.status ?? "—";
  const positive = cp >= 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="text-xs font-medium text-gray-500 dark:text-zinc-400">공헌이익</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
        {fmtKrw(cp)}
      </div>
      <div className="mt-0.5">
        <DeltaBadge delta={delta} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">
          마진 {fmtPct(margin, 1)}
        </span>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
          status === "흑자" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
          : status === "적자" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
          : "border-gray-200 bg-gray-50 text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        }`}>{status}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Mid charts
// ────────────────────────────────────────────────────────────────────────────

function DailyProfitChart({ rows, pal }: { rows: DailyRow[]; pal: ChartPalette }) {
  const today = todayStr();
  const current = rows.find((r) => r.date === today);
  const monthly = rows.length > MONTHLY_THRESHOLD;

  const data = monthly
    ? bucketMonthly(rows).map((m) => ({
        date: monthLabel(m.month),
        netRevenue: Math.round(m.netRevenue),
        adSpend: Math.round(m.adSpend),
        profitFinished: Math.round(m.contributionProfit),
        profitToday: null as number | null,
      }))
    : rows.map((r) => ({
        date: r.date,
        netRevenue: Math.round(r.netRevenue),
        adSpend: Math.round(r.adSpend),
        profitFinished: r.date < today ? Math.round(r.contributionProfit) : null,
        profitToday: r.date === today ? Math.round(r.contributionProfit) : null,
      }));

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 14, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: pal.axis }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: pal.axis }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => fmtKrwShort(v)} />
          <Tooltip
            formatter={(v: number, name: string) => {
              if (v === null) return ["—", ""];
              const label = name === "netRevenue" ? "순매출"
                          : name === "adSpend" ? "광고비"
                          : name === "profitFinished" ? "공헌이익"
                          : name === "profitToday" ? "공헌이익(당일·미완료)"
                          : name;
              return [fmtKrw(v), label];
            }}
            {...tooltipStyle(pal)}
          />
          <ReferenceLine y={0} stroke={pal.refline} strokeWidth={1} />
          <Bar dataKey="netRevenue" fill={pal.barRevenue} name="순매출" radius={[3, 3, 0, 0]}>
            {data.length <= 14 && (
              <LabelList dataKey="netRevenue" position="top" formatter={(v: number) => fmtKrwShort(v)} fontSize={9} fill={pal.axis} />
            )}
          </Bar>
          <Bar dataKey="adSpend" fill={pal.barAd} name="광고비" radius={[3, 3, 0, 0]}>
            {data.length <= 14 && (
              <LabelList dataKey="adSpend" position="top" formatter={(v: number) => fmtKrwShort(v)} fontSize={9} fill={pal.axis} />
            )}
          </Bar>
          <Line type="monotone" dataKey="profitFinished" stroke={pal.profit} strokeWidth={2.5} dot={false} name="공헌이익" />
          {!monthly && (
            <Line type="monotone" dataKey="profitToday" stroke={pal.today} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: pal.today }} name="당일" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {monthly ? (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">※ 62일 초과 기간은 월 단위 합계로 표시 — 시작·끝 달은 부분 데이터일 수 있음</p>
      ) : current ? (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">※ 회색 점선은 당일(미완료) 데이터</p>
      ) : null}
    </div>
  );
}

function MonthlyTrendChart({ monthly, pal }: { monthly: MonthlyRow[]; pal: ChartPalette }) {
  const data = monthly.map((m) => ({
    label: monthLabel(m.month),
    netRevenue: Math.round(m.netRevenue),
    adSpend: Math.round(m.adSpend),
    contributionProfit: Math.round(m.contributionProfit),
    roas: m.roas !== null ? Number(m.roas.toFixed(1)) : null,
  }));

  return (
    <div>
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 5 }}>
            <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: pal.axis }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="krw" tick={{ fontSize: 11, fill: pal.axis }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => fmtKrwShort(v)} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11, fill: pal.roas }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
            <Tooltip
              formatter={(v: number, name: string) => (name === "ROAS" ? [fmtPct(v, 1), name] : [fmtKrw(v), name])}
              {...tooltipStyle(pal)}
            />
            <Bar yAxisId="krw" dataKey="netRevenue" fill={pal.barRevenue} name="매출" radius={[3, 3, 0, 0]}>
              <LabelList dataKey="netRevenue" position="top" formatter={(v: number) => fmtKrwShort(v)} fontSize={10} fill={pal.axis} />
            </Bar>
            <Bar yAxisId="krw" dataKey="adSpend" fill={pal.barAd} name="광고비" radius={[3, 3, 0, 0]}>
              <LabelList dataKey="adSpend" position="top" formatter={(v: number) => fmtKrwShort(v)} fontSize={10} fill={pal.axis} />
            </Bar>
            <Line yAxisId="pct" type="monotone" dataKey="roas" stroke={pal.roas} strokeWidth={2.5}
              dot={{ r: 4, fill: pal.tooltipBg, stroke: pal.roas, strokeWidth: 2 }} name="ROAS">
              <LabelList dataKey="roas" position="top" formatter={(v: number) => `${v.toFixed(1)}%`} fontSize={10} fill={pal.roas} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 dark:text-zinc-400">
              <th className="py-1.5 pr-3 font-medium">구분</th>
              {data.map((d) => (
                <th key={d.label} className="py-1.5 pr-3 text-right font-medium">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            <tr className="text-gray-700 dark:text-zinc-300">
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.barRevenue }} />매출</span>
              </td>
              {data.map((d) => (
                <td key={d.label} className="py-1.5 pr-3 text-right tabular-nums">{NUM.format(d.netRevenue)}</td>
              ))}
            </tr>
            <tr className="text-gray-700 dark:text-zinc-300">
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.barAd }} />광고비</span>
              </td>
              {data.map((d) => (
                <td key={d.label} className="py-1.5 pr-3 text-right tabular-nums">{NUM.format(d.adSpend)}</td>
              ))}
            </tr>
            <tr className="text-gray-700 dark:text-zinc-300">
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.profit }} />공헌이익</span>
              </td>
              {data.map((d) => (
                <td key={d.label} className={`py-1.5 pr-3 text-right font-medium tabular-nums ${
                  d.contributionProfit > 0 ? "text-emerald-600 dark:text-emerald-400"
                  : d.contributionProfit < 0 ? "text-rose-600 dark:text-rose-400"
                  : ""
                }`}>{NUM.format(d.contributionProfit)}</td>
              ))}
            </tr>
            <tr className="text-gray-700 dark:text-zinc-300">
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.roas }} />ROAS</span>
              </td>
              {data.map((d) => (
                <td key={d.label} className="py-1.5 pr-3 text-right font-medium tabular-nums" style={{ color: pal.roas }}>
                  {d.roas !== null ? `${d.roas.toFixed(1)}%` : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">
        ※ 선택 기간 내 일자만 합산 — 시작·끝 달은 부분 월 데이터일 수 있음
      </p>
    </div>
  );
}

function RoasChart({ rows, pal }: { rows: DailyRow[]; pal: ChartPalette }) {
  const today = todayStr();
  const monthly = rows.length > MONTHLY_THRESHOLD;

  const data = monthly
    ? bucketMonthly(rows.filter((r) => r.date < today))
        .filter((m) => m.adSpend > 0)
        .map((m) => {
          const roas = calculateRoas(m.netRevenue, m.adSpend);
          const bep = calculateBreakEvenRoas(m.netRevenue, m.netRevenue - m.vat, m.pgFee, m.reportCost);
          return {
            date: monthLabel(m.month),
            roas: roas !== null ? Number(roas.toFixed(1)) : null,
            bep: Number(bep.toFixed(1)),
          };
        })
    : rows
        .filter((r) => r.adSpend > 0 && r.date < today)
        .map((r) => ({
          date: r.date,
          roas: r.roas !== null ? Number(r.roas.toFixed(1)) : null,
          bep: Number(r.breakEvenRoas.toFixed(1)),
        }));

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">광고비 집행 일자가 없습니다.</p>;
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: pal.axis }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: pal.axis }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
            {...tooltipStyle(pal)} />
          <Line type="monotone" dataKey="bep" stroke={pal.bep} strokeWidth={1.5} strokeDasharray="6 4" dot={false} name="손익분기 ROAS" />
          <Line type="monotone" dataKey="roas" stroke={pal.profit} strokeWidth={2.5} dot={false} name="ROAS" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HourlyChart({
  hourly, pal,
}: { hourly: Array<{ hour: number; amount: number; count: number }>; pal: ChartPalette }) {
  const total = hourly.reduce((a, h) => a + h.amount, 0);
  if (hourly.length === 0 || total <= 0) {
    return <p className="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }
  const peak = hourly.reduce((m, h) => (h.amount > m.amount ? h : m), hourly[0]);
  const data = hourly.map((h) => ({ ...h, label: `${h.hour}시` }));

  return (
    <div>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid stroke={pal.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: pal.axis }} tickLine={false} axisLine={false} interval={2} />
            <YAxis tick={{ fontSize: 11, fill: pal.axis }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => fmtKrwShort(v)} />
            <Tooltip
              formatter={(v: number, name: string, entry: any) => {
                const cnt = entry?.payload?.count ?? 0;
                return [`${fmtKrw(v)} · ${NUM.format(cnt)}건`, "결제"];
              }}
              {...tooltipStyle(pal)}
            />
            <Bar dataKey="amount" name="결제금액" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.hour} fill={d.hour === peak.hour ? pal.hourly : pal.barNet} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">
        피크 시간대 <span className="font-medium text-gray-600 dark:text-zinc-300">{peak.hour}시</span> ({fmtKrw(peak.amount)} · {NUM.format(peak.count)}건) · 결제 시각(KST) 기준 합산
      </p>
    </div>
  );
}

function CostStructureBar({ totals, pal }: { totals?: ProfitTotals; pal: ChartPalette }) {
  if (!totals || totals.netRevenue <= 0) {
    return <p className="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }
  const items = [
    { label: "광고비", value: totals.adSpend, color: pal.costSegments[0] },
    { label: "VAT", value: totals.vat, color: pal.costSegments[1] },
    { label: "PG 수수료", value: totals.pgFee, color: pal.costSegments[2] },
    { label: "리포트 생성원가", value: totals.reportCost, color: pal.costSegments[3] },
  ];
  const totalCost = items.reduce((a, b) => a + b.value, 0);
  const profitPositive = totals.contributionProfit >= 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-zinc-400">총 비용</span>
        <span className="font-semibold tabular-nums text-gray-900 dark:text-zinc-100">{fmtKrw(totalCost)}</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
        {items.filter((it) => it.value > 0).map((it) => {
          const pct = totalCost > 0 ? (it.value / totalCost) * 100 : 0;
          return <div key={it.label} style={{ width: `${pct}%`, background: it.color }} title={`${it.label} ${pct.toFixed(1)}%`} />;
        })}
      </div>
      <div className="space-y-2 text-xs">
        {items.map((it) => {
          const pct = totals.netRevenue > 0 ? (it.value / totals.netRevenue) * 100 : 0;
          return (
            <div key={it.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.color }} />
              <span className="flex-1 text-gray-600 dark:text-zinc-300">{it.label}</span>
              <span className="tabular-nums text-gray-900 dark:text-zinc-100">{fmtKrw(it.value)}</span>
              <span className="w-12 text-right tabular-nums text-gray-400 dark:text-zinc-500">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
        <div className="mt-2 border-t border-gray-100 pt-2 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-zinc-400">공헌이익</span>
            <span className={`font-semibold tabular-nums ${profitPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {fmtKrw(totals.contributionProfit)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 기간 요약 카드
// ────────────────────────────────────────────────────────────────────────────

function PeriodSummaryCard({
  totals, daily, sourceNetRevenue,
}: {
  totals?: ProfitTotals;
  daily: DailyRow[];
  sourceNetRevenue: number;
}) {
  if (!totals) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }
  const today = todayStr();
  const finished = daily.filter((d) => d.date < today);
  const avgProfit = finished.length > 0
    ? finished.reduce((a, d) => a + d.contributionProfit, 0) / finished.length
    : 0;
  const bestDay = finished.length > 0
    ? finished.reduce((m, d) => (d.contributionProfit > m.contributionProfit ? d : m), finished[0])
    : null;

  const rows: Array<{ label: string; value: string; tone?: "good" | "warn" }> = [
    { label: "기간", value: `${daily.length}일` },
    { label: "결제매출", value: fmtKrw(sourceNetRevenue) },
    { label: "광고비", value: fmtKrw(totals.adSpend) },
    { label: "공헌이익", value: fmtKrw(totals.contributionProfit), tone: totals.contributionProfit >= 0 ? "good" : "warn" },
    { label: "일평균 공헌이익", value: fmtKrw(avgProfit) },
    { label: "최고 이익일", value: bestDay ? `${bestDay.date} · ${fmtKrw(bestDay.contributionProfit)}` : "—" },
    { label: "ROAS", value: fmtPct(totals.roas, 1) },
  ];

  return (
    <div className="divide-y divide-gray-100 dark:divide-zinc-800">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
          <span className="text-gray-500 dark:text-zinc-400">{r.label}</span>
          <span className={`tabular-nums font-semibold ${
            r.tone === "good" ? "text-emerald-600 dark:text-emerald-400"
            : r.tone === "warn" ? "text-rose-600 dark:text-rose-400"
            : "text-gray-900 dark:text-zinc-100"
          }`}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Insight panel
// ────────────────────────────────────────────────────────────────────────────

function InsightPanel({
  totals, daily, sourceNetRevenue, settings,
}: {
  totals?: ProfitTotals;
  daily: DailyRow[];
  sourceNetRevenue: number;
  settings?: { pgFeeRate: number; reportCostPerUnit: number };
}) {
  if (!totals) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }
  const today = todayStr();
  const finished = daily.filter((d) => d.date < today);
  const sortedByProfit = [...finished].sort((a, b) => b.contributionProfit - a.contributionProfit);
  const bestDay = sortedByProfit[0];
  const worstDay = sortedByProfit[sortedByProfit.length - 1];

  const lines: Array<{ tone: "good" | "warn" | "info"; text: string }> = [];

  if (totals.status === "흑자") {
    lines.push({ tone: "good", text: `공헌이익 +${fmtKrw(totals.contributionProfit)} (마진 ${fmtPct(totals.contributionMargin)}) — 흑자 구조.` });
  } else if (totals.status === "적자") {
    lines.push({ tone: "warn", text: `공헌이익 ${fmtKrw(totals.contributionProfit)} (마진 ${fmtPct(totals.contributionMargin)}) — 적자.` });
  } else {
    lines.push({ tone: "info", text: "공헌이익이 손익분기 부근." });
  }

  if (totals.adSpend > 0 && totals.roas !== null) {
    if (totals.adAdvice === "증액 가능") {
      lines.push({ tone: "good", text: `ROAS ${fmtPct(totals.roas, 1)} > BEP ${fmtPct(totals.breakEvenRoas, 1)} — 광고 증액 여력.` });
    } else {
      lines.push({ tone: "warn", text: `ROAS ${fmtPct(totals.roas, 1)} ≤ BEP ${fmtPct(totals.breakEvenRoas, 1)} — 광고비 효율 점검 필요.` });
    }
  } else if (totals.adSpend <= 0) {
    lines.push({ tone: "info", text: "광고비 집행 없음 — ROAS 계산 불가." });
  }

  if (bestDay && bestDay.contributionProfit > 0) {
    lines.push({ tone: "info", text: `최고 이익일: ${bestDay.date} (+${fmtKrw(bestDay.contributionProfit)})` });
  }
  if (worstDay && worstDay.contributionProfit < 0 && worstDay.date !== bestDay?.date) {
    lines.push({ tone: "warn", text: `최대 손실일: ${worstDay.date} (${fmtKrw(worstDay.contributionProfit)})` });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              l.tone === "good" ? "bg-emerald-500" : l.tone === "warn" ? "bg-rose-500" : "bg-gray-400 dark:bg-zinc-500"
            }`} />
            <span className={
              l.tone === "good" ? "text-emerald-700 dark:text-emerald-400"
              : l.tone === "warn" ? "text-rose-700 dark:text-rose-400"
              : "text-gray-600 dark:text-zinc-300"
            }>{l.text}</span>
          </li>
        ))}
      </ul>
      {settings && (
        <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-400 dark:border-zinc-800 dark:text-zinc-500">
          PG {(settings.pgFeeRate * 100).toFixed(2)}% · 리포트 {fmtKrw(settings.reportCostPerUnit)}/건 · 순매출 {fmtKrw(sourceNetRevenue)}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Bottom detail tables
// ────────────────────────────────────────────────────────────────────────────

function DailyTable({ rows, loading }: { rows: DailyRow[]; loading: boolean }) {
  if (!loading && rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const today = todayStr();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-zinc-400">
            <th className="py-2 pr-3 font-medium">날짜</th>
            <th className="py-2 pr-3 text-right font-medium">순매출</th>
            <th className="py-2 pr-3 text-right font-medium">광고비</th>
            <th className="py-2 pr-3 text-right font-medium">공헌이익</th>
            <th className="py-2 pr-3 text-right font-medium">마진</th>
            <th className="py-2 text-right font-medium">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {sorted.map((r) => {
            const profitColor = r.contributionProfit > 0 ? "text-emerald-600 dark:text-emerald-400"
                              : r.contributionProfit < 0 ? "text-rose-600 dark:text-rose-400"
                              : "text-gray-500 dark:text-zinc-400";
            const belowBep = r.roas !== null && r.roas < r.breakEvenRoas && r.adSpend > 0;
            const isToday = r.date === today;
            return (
              <tr key={r.date} className={`${belowBep ? "bg-rose-50/40 dark:bg-rose-950/20" : ""} ${isToday ? "text-gray-400 dark:text-zinc-500" : "text-gray-700 dark:text-zinc-300"}`}>
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.date}{isToday && <span className="ml-1 text-[10px]">(당일)</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.netRevenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.adSpend)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-medium ${isToday ? "" : profitColor}`}>
                  {fmtKrw(r.contributionProfit)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.contributionMargin)}</td>
                <td className={`py-2 text-right tabular-nums ${belowBep ? "text-rose-600 font-medium dark:text-rose-400" : ""}`}>
                  {fmtPct(r.roas, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-gray-400 dark:text-zinc-500">※ 손익분기 ROAS 미만 행은 옅은 적색 배경 · 당일(미완료) 은 회색</p>
    </div>
  );
}

function CampaignTop10({ campaigns, bep }: { campaigns: CampaignRow[]; bep: number }) {
  if (campaigns.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">광고 캠페인 데이터가 없습니다.</p>;
  }
  const top10 = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 10);
  const maxSpend = Math.max(...top10.map((c) => c.spend), 1);

  return (
    <div className="space-y-3">
      {top10.map((c) => {
        const pct = (c.spend / maxSpend) * 100;
        const aboveBep = c.roas !== null && c.roas >= bep;
        return (
          <div key={c.campaignId} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-xs text-gray-600 dark:text-zinc-300 sm:w-40" title={c.campaignName}>
              {c.campaignName}
            </div>
            <div className="h-2 flex-1 rounded-full bg-gray-100 dark:bg-zinc-800">
              <div className="h-2 rounded-full bg-portone" style={{ width: `${pct}%` }} />
            </div>
            <div className="w-24 shrink-0 text-right text-xs tabular-nums text-gray-900 dark:text-zinc-100">
              {fmtKrw(c.spend)}
            </div>
            <span className={`w-16 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums ${
              c.roas === null ? "bg-gray-100 text-gray-400 dark:bg-zinc-800 dark:text-zinc-500"
              : aboveBep ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
            }`}>
              {fmtPct(c.roas, 0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatBudget(c: CampaignRow): string {
  // 예산 표시 규칙:
  //   daily_budget 우선 (운영자가 일 단위로 조정하는 게 일반적).
  //   둘 다 null/0 이면 "-".
  if (c.dailyBudget && c.dailyBudget > 0) return `${fmtKrw(c.dailyBudget)} / 일`;
  if (c.lifetimeBudget && c.lifetimeBudget > 0) return `${fmtKrw(c.lifetimeBudget)} (총액)`;
  return "—";
}

function CampaignTable({
  campaigns, loading, error,
}: { campaigns: CampaignRow[]; loading: boolean; error: string | null }) {
  if (error) return <p className="py-8 text-center text-sm text-amber-700 dark:text-amber-400">{error}</p>;
  if (!loading && campaigns.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">광고 캠페인 데이터가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-zinc-400">
            <th className="py-2 pr-4 font-medium">캠페인</th>
            <th className="py-2 pr-3 text-right font-medium">결과</th>
            <th className="py-2 pr-3 text-right font-medium">CPA</th>
            <th className="py-2 pr-3 text-right font-medium">예산</th>
            <th className="py-2 pr-3 text-right font-medium">지출금액</th>
            <th className="py-2 pr-3 text-right font-medium">ROAS</th>
            <th className="py-2 pr-3 text-right font-medium">CTR</th>
            <th className="py-2 pr-3 text-right font-medium">빈도</th>
            <th className="py-2 pr-3 text-right font-medium">CVR</th>
            <th className="py-2 text-right font-medium">CPM</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {campaigns.map((c) => (
            <tr key={c.campaignId} className="text-gray-700 dark:text-zinc-300">
              <td className="py-2 pr-4">
                <div className="truncate max-w-[260px]" title={c.campaignName}>{c.campaignName}</div>
                <div className="text-[10px] text-gray-400 dark:text-zinc-500">{c.campaignId}</div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {c.purchases > 0 ? NUM.format(c.purchases) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {c.cpa !== null ? fmtKrw(c.cpa) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{formatBudget(c)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(c.spend)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(c.roas, 1)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(c.ctr, 1)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {c.frequency !== null ? c.frequency.toFixed(1) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(c.cvr, 1)}</td>
              <td className="py-2 text-right tabular-nums">
                {c.cpm !== null ? fmtKrw(c.cpm) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChannelTopList({
  channels,
}: { channels: Array<{ label: string; net: number; pct: number; count: number }> }) {
  if (channels.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">데이터 없음</p>;
  }
  return (
    <div className="space-y-3">
      {channels.map((c, i) => (
        <div key={c.label} className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{i + 1}</div>
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-zinc-100">{c.label}</div>
            <div className="text-xs text-gray-500 dark:text-zinc-400">{fmtKrw(c.net)} · {NUM.format(c.count)}건</div>
          </div>
          <div className="w-14 rounded-md bg-portone-50 px-2 py-1 text-right text-xs font-medium text-portone-600 dark:bg-portone/10 dark:text-portone">
            {c.pct.toFixed(1)}%
          </div>
          <div className="hidden h-2 flex-1 max-w-[120px] rounded bg-portone-50 md:block dark:bg-portone/10">
            <div className="h-2 rounded bg-portone" style={{ width: `${Math.min(100, c.pct)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
