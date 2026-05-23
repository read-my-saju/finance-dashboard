"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, until });
    if (force) qs.set("force", "1");
    const q = qs.toString();
    try {
      const [pRes, sRes, dRes, cRes] = await Promise.all([
        fetch(`/api/payments?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/summary?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/daily?${q}`, { cache: "no-store" }),
        fetch(`/api/dashboard/meta-campaigns?${q}`, { cache: "no-store" }),
      ]);
      const [pJson, sJson, dJson, cJson] = await Promise.all([
        pRes.json(), sRes.json(), dRes.json(), cRes.json(),
      ]);
      if (!pRes.ok) {
        setError(pJson?.detail || pJson?.error || `payments HTTP ${pRes.status}`);
      } else {
        setPayments(pJson);
      }
      if (sRes.ok) setSummary(sJson);
      if (dRes.ok) setDaily(dJson);
      if (cRes.ok) setCampaigns(cJson);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [from, until]);

  useEffect(() => { load(false); }, [load]);

  // 화면 순매출 = PortOne 콘솔 순거래액 = payments.netRevenue (단일 진실)
  // summary.totals.netRevenue 도 같은 값이지만 위 값을 우선 사용해 UI 동기화 보장.
  const sourceNetRevenue = payments?.netRevenue ?? summary?.totals.netRevenue ?? 0;

  const metaError = summary?.metaError || daily?.metaError || campaigns?.metaError || null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Header
        fetchedAt={payments?.fetchedAt}
        cached={Boolean(payments?.cached && summary?.cached && daily?.cached)}
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
      />

      {/* ── 2. 중단 차트 3개 ───────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="일별 손익" badge={daily ? `${daily.daily.length}일` : "—"} />
          <DailyProfitChart rows={daily?.daily ?? []} />
        </Card>
        <Card>
          <CardHeader
            title="ROAS vs 손익분기 ROAS"
            badge="BEP 118% · 결제매출 기준"
          />
          <RoasChart rows={daily?.daily ?? []} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="비용 구조" />
          <CostDonut totals={summary?.totals} />
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

      {/* ── 3. 하단 상세 (접기 가능) ────────────────────────────────────── */}
      <div className="mt-8 space-y-4">
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

      <p className="mt-8 text-xs text-gray-400">
        데이터 출처: PortOne V2 API · Meta Marketing API · Google Play 인앱결제는 본 대시보드에 포함되지 않음
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout pieces
// ────────────────────────────────────────────────────────────────────────────

function Header({ fetchedAt, cached }: { fetchedAt?: string; cached?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">결제 · 광고 손익 대시보드</h1>
        <p className="mt-0.5 text-xs text-gray-400">Read My Saju · PortOne × Meta</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {fetchedAt && <span>업데이트 {new Date(fetchedAt).toLocaleString("ko-KR")}</span>}
        {cached && <span className="rounded bg-gray-100 px-2 py-0.5">cached</span>}
      </div>
    </div>
  );
}

function FilterBar({
  from, until, setFrom, setUntil, loading, onRefresh, onLogout,
}: {
  from: string; until: string;
  setFrom: (s: string) => void; setUntil: (s: string) => void;
  loading: boolean; onRefresh: () => void; onLogout: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
        <span className="text-gray-500">시작</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent outline-none" />
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
        <span className="text-gray-500">종료</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="bg-transparent outline-none" />
      </div>
      <button type="button" onClick={() => { setFrom(todayStr()); setUntil(todayStr()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">오늘</button>
      <button type="button" onClick={() => { setFrom(daysAgo(1)); setUntil(daysAgo(1)); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">어제</button>
      <button type="button" onClick={() => { setFrom("2026-01-01"); setUntil(todayStr()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">전체 기간</button>
      <button type="button" onClick={() => { setFrom(daysAgo(29)); setUntil(todayStr()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">최근 30일</button>
      <button type="button" onClick={() => { setFrom(daysAgo(6)); setUntil(todayStr()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">최근 7일</button>
      <div className="grow" />
      <button type="button" onClick={onRefresh} disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-portone px-4 py-2 text-sm font-medium text-white hover:bg-portone-600 disabled:opacity-50">
        <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
        </svg>
        {loading ? "불러오는 중…" : "새로고침"}
      </button>
      <button type="button" onClick={onLogout}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">로그아웃</button>
    </div>
  );
}

function Banner({ tone, title, body }: { tone: "error" | "warn"; title: string; body: string }) {
  const cls = tone === "error"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div className="font-medium">{title}</div>
      <div className={`mt-1 ${tone === "error" ? "text-rose-600" : "text-amber-700"}`}>{body}</div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-200 bg-white p-5 ${className}`}>{children}</div>;
}

function CardHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {badge && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{badge}</span>}
    </div>
  );
}

function CollapsibleCard({
  title, subtitle, defaultOpen, children,
}: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-gray-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-gray-900">
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {subtitle && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">{subtitle}</span>}
        </div>
        <svg className="h-4 w-4 text-gray-400 transition group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="border-t border-gray-100 px-5 py-4">{children}</div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 1. KPI Strip — 6 cards
// ────────────────────────────────────────────────────────────────────────────

function KpiStrip({
  totals, sourceNetRevenue, daily,
}: {
  totals?: ProfitTotals;
  sourceNetRevenue: number;
  daily: DailyRow[];
}) {
  // 전기간 증감 = 전반부 평균 vs 후반부 평균 (당일 제외)
  const finishedDaily = useMemo(() => {
    const today = todayStr();
    return daily.filter((d) => d.date < today);
  }, [daily]);

  function delta(getter: (d: DailyRow) => number): number | null {
    const arr = finishedDaily;
    if (arr.length < 2) return null;
    const half = Math.floor(arr.length / 2);
    const prev = arr.slice(0, half).map(getter);
    const cur = arr.slice(half).map(getter);
    if (prev.length === 0 || cur.length === 0) return null;
    const pavg = prev.reduce((a, b) => a + b, 0) / prev.length;
    const cavg = cur.reduce((a, b) => a + b, 0) / cur.length;
    return pctChange(pavg, cavg);
  }

  const netDelta = delta((d) => d.netRevenue);
  const adDelta = delta((d) => d.adSpend);
  const pgDelta = delta((d) => d.pgFee);
  const reportDelta = delta((d) => d.reportCost);

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
      />
      <KpiCard
        label="광고비"
        value={totals?.adSpend ?? 0}
        delta={adDelta}
        deltaInverse
        sparkData={finishedDaily.map((d) => d.adSpend)}
      />
      <KpiCard
        label="결제수수료 (PG)"
        value={totals?.pgFee ?? 0}
        delta={pgDelta}
        deltaInverse
        sparkData={finishedDaily.map((d) => d.pgFee)}
      />
      <KpiCard
        label="리포트 생성원가"
        value={totals?.reportCost ?? 0}
        delta={reportDelta}
        deltaInverse
        sparkData={finishedDaily.map((d) => d.reportCost)}
      />
      <RoasKpiCard totals={totals} />
      <ProfitKpiCard totals={totals} />
    </div>
  );
}

function KpiCard({
  label, value, delta, deltaInverse, sparkData, subText,
}: {
  label: string;
  value: number;
  delta: number | null;
  deltaInverse?: boolean;        // 광고비/수수료처럼 "줄어드는 게 좋은" 지표는 색 반전
  sparkData: number[];
  subText?: string;
}) {
  const sparkPoints = sparkData.map((v, i) => ({ x: i, y: v }));
  const positive = delta !== null && delta >= 0;
  const goodColor = deltaInverse ? !positive : positive;
  const arrowColor = delta === null
    ? "text-gray-400"
    : goodColor ? "text-emerald-600" : "text-rose-600";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900">
        {fmtKrw(value)}
      </div>
      {subText && (
        <div className="mt-0.5 text-[11px] text-gray-400">{subText}</div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <div className={`text-xs font-medium ${arrowColor}`}>
          {delta === null ? "—" : `${positive ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%`}
        </div>
        <div className="h-6 w-20">
          {sparkData.length >= 2 && (
            <ResponsiveContainer>
              <LineChart data={sparkPoints}>
                <Line type="monotone" dataKey="y" stroke="#FF6F0F" strokeWidth={1.5} dot={false} isAnimationActive={false} />
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
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">ROAS</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900">
        {fmtPct(roas, 1)}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-400">
        포트원 결제매출(VAT 포함) ÷ 광고비 · 손익분기 118%
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`min-w-0 flex-1 text-xs font-medium ${
          diff === null ? "text-gray-400" : above ? "text-emerald-600" : "text-rose-600"
        }`}>
          {`BEP 118% 대비 ${diff !== null ? (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%p" : "—"}`}
        </span>
        <span className={`shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
          advice === "증액 가능" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : advice === "광고비 주의" ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-gray-200 bg-gray-50 text-gray-500"
        }`}>{advice}</span>
      </div>
    </div>
  );
}

function ProfitKpiCard({ totals }: { totals?: ProfitTotals }) {
  const cp = totals?.contributionProfit ?? 0;
  const margin = totals?.contributionMargin ?? null;
  const status = totals?.status ?? "—";
  const positive = cp >= 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">공헌이익</div>
      <div className={`mt-1.5 text-2xl font-bold tracking-tight ${positive ? "text-emerald-600" : "text-rose-600"}`}>
        {fmtKrw(cp)}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">
          마진 {fmtPct(margin, 1)}
        </span>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
          status === "흑자" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "적자" ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-gray-200 bg-gray-50 text-gray-500"
        }`}>{status}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Mid charts
// ────────────────────────────────────────────────────────────────────────────

function DailyProfitChart({ rows }: { rows: DailyRow[] }) {
  const today = todayStr();
  const finished = rows.filter((r) => r.date < today);
  const current = rows.find((r) => r.date === today);

  const data = rows.map((r) => ({
    date: r.date,
    netRevenue: Math.round(r.netRevenue),
    adSpend: Math.round(r.adSpend),
    profitFinished: r.date < today ? Math.round(r.contributionProfit) : null,
    profitToday: r.date === today ? Math.round(r.contributionProfit) : null,
  }));

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">데이터 없음</p>;
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false}
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
            labelStyle={{ color: "#6b7280", fontSize: 12 }}
            contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
          <Bar dataKey="netRevenue" fill="#e5e7eb" name="순매출" />
          <Bar dataKey="adSpend" fill="#fda4af" name="광고비" />
          <Line type="monotone" dataKey="profitFinished" stroke="#0f766e" strokeWidth={2.5} dot={false} name="공헌이익" />
          <Line type="monotone" dataKey="profitToday" stroke="#9ca3af" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: "#9ca3af" }} name="당일" />
        </ComposedChart>
      </ResponsiveContainer>
      {current && (
        <p className="mt-2 text-[11px] text-gray-400">※ 회색 점선은 당일(미완료) 데이터</p>
      )}
    </div>
  );
}

function RoasChart({ rows }: { rows: DailyRow[] }) {
  const today = todayStr();
  const data = rows
    .filter((r) => r.adSpend > 0 && r.date < today)
    .map((r) => ({
      date: r.date,
      roas: r.roas !== null ? Number(r.roas.toFixed(1)) : null,
    }));

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">광고비 집행 일자가 없습니다.</p>;
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "ROAS"]} />
          <ReferenceLine
            y={118}
            stroke="#fb7185"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            label={{ value: "BEP 118% (결제매출 기준)", position: "insideTopRight", fill: "#fb7185", fontSize: 11 }}
          />
          <Line type="monotone" dataKey="roas" stroke="#0f766e" strokeWidth={2.5} dot={false} name="ROAS" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostDonut({ totals }: { totals?: ProfitTotals }) {
  if (!totals || totals.netRevenue <= 0) {
    return <p className="py-12 text-center text-sm text-gray-400">데이터 없음</p>;
  }
  const items = [
    { label: "VAT", value: totals.vat, color: "#94a3b8" },
    { label: "PG 수수료", value: totals.pgFee, color: "#a78bfa" },
    { label: "리포트 생성원가", value: totals.reportCost, color: "#fbbf24" },
    { label: "광고비", value: totals.adSpend, color: "#fb7185" },
  ];
  const totalCost = items.reduce((a, b) => a + b.value, 0);
  const profitPositive = totals.contributionProfit >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="relative h-44 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="label" innerRadius={50} outerRadius={75} stroke="white" strokeWidth={2}>
              {items.map((it) => <Cell key={it.label} fill={it.color} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [fmtKrw(v), n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-gray-400">총 비용</span>
          <span className="text-sm font-semibold text-gray-900">{fmtKrw(totalCost)}</span>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        {items.map((it) => {
          const pct = totals.netRevenue > 0 ? (it.value / totals.netRevenue) * 100 : 0;
          return (
            <div key={it.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.color }} />
              <span className="flex-1 text-gray-600">{it.label}</span>
              <span className="tabular-nums text-gray-900">{fmtKrw(it.value)}</span>
              <span className="w-12 text-right tabular-nums text-gray-400">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
        <div className="mt-2 border-t border-gray-100 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">공헌이익</span>
            <span className={`font-semibold ${profitPositive ? "text-emerald-600" : "text-rose-600"}`}>
              {fmtKrw(totals.contributionProfit)}
            </span>
          </div>
        </div>
      </div>
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
    return <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>;
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
      lines.push({ tone: "good", text: `ROAS ${fmtPct(totals.roas, 1)} > BEP 118% — 광고 증액 여력.` });
    } else {
      lines.push({ tone: "warn", text: `ROAS ${fmtPct(totals.roas, 1)} ≤ BEP 118% — 광고비 효율 점검 필요.` });
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
              l.tone === "good" ? "bg-emerald-500" : l.tone === "warn" ? "bg-rose-500" : "bg-gray-400"
            }`} />
            <span className={
              l.tone === "good" ? "text-emerald-700"
              : l.tone === "warn" ? "text-rose-700"
              : "text-gray-600"
            }>{l.text}</span>
          </li>
        ))}
      </ul>
      {settings && (
        <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-400">
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
    return <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>;
  }
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const today = todayStr();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="py-2 pr-3 font-medium">날짜</th>
            <th className="py-2 pr-3 text-right font-medium">순매출</th>
            <th className="py-2 pr-3 text-right font-medium">광고비</th>
            <th className="py-2 pr-3 text-right font-medium">공헌이익</th>
            <th className="py-2 pr-3 text-right font-medium">마진</th>
            <th className="py-2 text-right font-medium">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((r) => {
            const profitColor = r.contributionProfit > 0 ? "text-emerald-600"
                              : r.contributionProfit < 0 ? "text-rose-600"
                              : "text-gray-500";
            const belowBep = r.roas !== null && r.roas < r.breakEvenRoas && r.adSpend > 0;
            const isToday = r.date === today;
            return (
              <tr key={r.date} className={`${belowBep ? "bg-rose-50/40" : ""} ${isToday ? "text-gray-400" : "text-gray-700"}`}>
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.date}{isToday && <span className="ml-1 text-[10px]">(당일)</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.netRevenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.adSpend)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-medium ${isToday ? "" : profitColor}`}>
                  {fmtKrw(r.contributionProfit)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.contributionMargin)}</td>
                <td className={`py-2 text-right tabular-nums ${belowBep ? "text-rose-600 font-medium" : ""}`}>
                  {fmtPct(r.roas, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-gray-400">※ BEP 118% 미만 행은 옅은 적색 배경 · 당일(미완료) 은 회색</p>
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
  if (error) return <p className="py-8 text-center text-sm text-amber-700">{error}</p>;
  if (!loading && campaigns.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">광고 캠페인 데이터가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
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
        <tbody className="divide-y divide-gray-100">
          {campaigns.map((c) => (
            <tr key={c.campaignId} className="text-gray-700">
              <td className="py-2 pr-4">
                <div className="truncate max-w-[260px]" title={c.campaignName}>{c.campaignName}</div>
                <div className="text-[10px] text-gray-400">{c.campaignId}</div>
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
    return <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>;
  }
  return (
    <div className="space-y-3">
      {channels.map((c, i) => (
        <div key={c.label} className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white">{i + 1}</div>
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">{c.label}</div>
            <div className="text-xs text-gray-500">{fmtKrw(c.net)} · {NUM.format(c.count)}건</div>
          </div>
          <div className="w-14 rounded-md bg-portone-50 px-2 py-1 text-right text-xs font-medium text-portone-600">
            {c.pct.toFixed(1)}%
          </div>
          <div className="hidden h-2 flex-1 max-w-[120px] rounded bg-portone-50 md:block">
            <div className="h-2 rounded bg-portone" style={{ width: `${Math.min(100, c.pct)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
