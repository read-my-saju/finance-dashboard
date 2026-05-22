"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
  cached?: boolean;
};

type ProfitTotals = {
  netRevenue: number;
  vat: number;
  pgFee: number;
  reportCost: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  availableBeforeAds: number;
  breakEvenRoas: number | null;
  status: "흑자" | "손익분기" | "적자";
  adAdvice: "증액 가능" | "광고비 주의" | "광고비 없음";
  paidAmount: number;
  cancelledAmount: number;
  reportCount: number;
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
  pgFee: number;
  reportCost: number;
  adSpend: number;
  contributionProfit: number;
  contributionMargin: number | null;
  roas: number | null;
  breakEvenRoas: number | null;
  reportCount: number;
  paidAmount: number;
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
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
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

const KRW = new Intl.NumberFormat("ko-KR");

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diffDays(from: string, until: string): number {
  const a = new Date(from).getTime();
  const b = new Date(until).getTime();
  return Math.max(0, Math.round((b - a) / (24 * 3600 * 1000))) + 1;
}

function fmtKrw(n: number): string {
  return KRW.format(Math.round(n));
}

function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function shortKrw(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}

function statusColor(s: ProfitTotals["status"]): string {
  if (s === "흑자") return "text-emerald-600";
  if (s === "적자") return "text-rose-600";
  return "text-gray-500";
}

function adviceColor(s: ProfitTotals["adAdvice"]): string {
  if (s === "증액 가능") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "광고비 주의") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-gray-50 text-gray-500 border-gray-200";
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [from, setFrom] = useState<string>(() => "2026-01-01");
  const [until, setUntil] = useState<string>(() => today());
  const [payments, setPayments] = useState<PaymentsData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [daily, setDaily] = useState<DailyData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"weekly" | "daily">("weekly");

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
        pRes.json(),
        sRes.json(),
        dRes.json(),
        cRes.json(),
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

  const chartData = useMemo(() => {
    if (!payments) return [];
    if (granularity === "weekly") {
      return payments.weekly.map((w) => ({ x: w.weekStart, y: w.gross }));
    }
    return payments.daily.map((d) => ({ x: d.date, y: d.gross }));
  }, [payments, granularity]);

  const topChannels = payments?.byChannel.slice(0, 5) ?? [];
  const metaError = summary?.metaError || daily?.metaError || campaigns?.metaError || null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
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
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {metaError && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-medium">광고 데이터 알림</div>
          <div className="mt-1 text-amber-700">{metaError}</div>
        </div>
      )}

      {/* ── 결제 거래 KPI (PortOne 화면 그대로) ───────────────────────────── */}
      <SectionTitle>결제 거래</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="거래액" value={payments?.gross ?? 0} accent="black" />
        <KpiCard label="순거래액" value={payments?.netRevenue ?? 0} accent="black" />
        <KpiCard label="거래취소액" value={payments?.cancelled ?? 0} accent="black" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="거래액 그래프"
            badge={payments ? `${diffDays(payments.range.from, payments.range.until)}일간` : "-"}
            right={
              <div className="flex rounded-lg border border-gray-200 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setGranularity("weekly")}
                  className={`rounded-md px-3 py-1 ${granularity === "weekly" ? "bg-gray-900 text-white" : "text-gray-500"}`}
                >
                  주간
                </button>
                <button
                  type="button"
                  onClick={() => setGranularity("daily")}
                  className={`rounded-md px-3 py-1 ${granularity === "daily" ? "bg-gray-900 text-white" : "text-gray-500"}`}
                >
                  일간
                </button>
              </div>
            }
          />
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => shortKrw(v)}
                />
                <Tooltip
                  formatter={(v: number) => [`${KRW.format(v)} 원`, "거래액"]}
                  labelStyle={{ color: "#6b7280", fontSize: 12 }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Line type="monotone" dataKey="y" stroke="#FF6F0F" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="결제수단별 순거래액 TOP5"
            badge={payments ? `${diffDays(payments.range.from, payments.range.until)}일간` : "-"}
          />
          <div className="space-y-3">
            {topChannels.length === 0 && !loading && (
              <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>
            )}
            {topChannels.map((c, i) => (
              <div key={c.label} className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{c.label}</div>
                  <div className="text-xs text-gray-500">{fmtKrw(c.net)}</div>
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
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <InfoCard label="결제완료" value={`${KRW.format(payments?.paidCount ?? 0)} 건`} hint="PortOne status = PAID" />
        <InfoCard label="환불/취소 발생" value={`${KRW.format(payments?.cancelCount ?? 0)} 건`} hint="amount.cancelled > 0" />
      </div>

      {/* ── 광고 손익 ─────────────────────────────────────────────────────── */}
      <div className="mt-12">
        <SectionTitle>광고 손익 (PortOne × Meta)</SectionTitle>
        <ProfitKpis totals={summary?.totals} />

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="일별 손익" badge={daily ? `${daily.daily.length}일` : "-"} />
            <DailyProfitChart rows={daily?.daily ?? []} />
          </Card>
          <Card>
            <CardHeader title="ROAS vs 손익분기 ROAS" />
            <RoasChart rows={daily?.daily ?? []} />
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="비용 구조 (기간 합계)" />
            <CostBreakdown totals={summary?.totals} />
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Meta 캠페인 (광고비 큰 순)" badge={campaigns ? `${campaigns.campaigns.length}개` : "-"} />
            <CampaignTable campaigns={campaigns?.campaigns ?? []} loading={loading} error={campaigns?.metaError ?? null} />
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="일별 손익 표" />
            <DailyTable rows={daily?.daily ?? []} loading={loading} />
          </Card>
          <Card>
            <CardHeader title="인사이트" />
            <InsightPanel totals={summary?.totals} daily={daily?.daily ?? []} settings={summary?.settings} />
          </Card>
        </div>
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
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold text-gray-900">결제 · 광고 손익 대시보드</h1>
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
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
        <span className="text-gray-500">시작</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent outline-none" />
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
        <span className="text-gray-500">종료</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="bg-transparent outline-none" />
      </div>
      <button type="button" onClick={() => { setFrom("2026-01-01"); setUntil(today()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
        전체 기간
      </button>
      <button type="button" onClick={() => { setFrom(daysAgo(29)); setUntil(today()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
        최근 30일
      </button>
      <button type="button" onClick={() => { setFrom(daysAgo(6)); setUntil(today()); }}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
        최근 7일
      </button>
      <div className="grow" />
      <button
        type="button" onClick={onRefresh} disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-portone px-4 py-2 text-sm font-medium text-white hover:bg-portone-600 disabled:opacity-50"
        title="PortOne + Meta API 재호출 (캐시 무시)"
      >
        <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
        {loading ? "불러오는 중…" : "새로고침"}
      </button>
      <button type="button" onClick={onLogout}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
        로그아웃
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{children}</h2>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-200 bg-white p-5 ${className}`}>{children}</div>;
}

function CardHeader({ title, badge, right }: { title: string; badge?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {badge && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{badge}</span>}
      </div>
      {right}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: "black" | "orange" }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-2 text-sm text-gray-500">{label}</div>
      <div className={`text-3xl font-bold ${accent === "orange" ? "text-portone" : "text-gray-900"}`}>
        {fmtKrw(value)}
        <span className="ml-1 text-xl text-gray-500">원</span>
      </div>
    </div>
  );
}

function InfoCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Profit KPI cards
// ────────────────────────────────────────────────────────────────────────────

function ProfitKpis({ totals }: { totals?: ProfitTotals }) {
  const t = totals;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm text-gray-500">순거래액 (VAT 포함)</div>
        <div className="mt-2 text-3xl font-bold text-gray-900">
          {fmtKrw(t?.netRevenue ?? 0)}
          <span className="ml-1 text-xl text-gray-500">원</span>
        </div>
        <div className="mt-1 text-xs text-gray-400">실결제 = 결제 - 환불</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm text-gray-500">광고비 (Meta)</div>
        <div className="mt-2 text-3xl font-bold text-gray-900">
          {fmtKrw(t?.adSpend ?? 0)}
          <span className="ml-1 text-xl text-gray-500">원</span>
        </div>
        <div className="mt-1 text-xs text-gray-400">광고계정 spend 합계</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm text-gray-500">기여이익</div>
        <div className={`mt-2 text-3xl font-bold ${t ? statusColor(t.status) : "text-gray-900"}`}>
          {fmtKrw(t?.contributionProfit ?? 0)}
          <span className="ml-1 text-xl text-gray-500">원</span>
        </div>
        <div className="mt-1 text-xs">
          <span className={`${t ? statusColor(t.status) : "text-gray-500"} font-medium`}>
            {t?.status ?? "—"}
          </span>
          <span className="ml-2 text-gray-400">
            마진 {fmtPct(t?.contributionMargin ?? null)}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="text-sm text-gray-500">ROAS</div>
        <div className="mt-2 text-3xl font-bold text-gray-900">
          {fmtPct(t?.roas ?? null, 0)}
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-gray-400">손익분기 {fmtPct(t?.breakEvenRoas ?? null, 0)}</span>
          <span className={`rounded-md border px-2 py-0.5 ${t ? adviceColor(t.adAdvice) : "border-gray-200 text-gray-500"}`}>
            {t?.adAdvice ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Daily P/L chart
// ────────────────────────────────────────────────────────────────────────────

function DailyProfitChart({ rows }: { rows: DailyRow[] }) {
  const data = rows.map((r) => ({
    date: r.date,
    netRevenue: Math.round(r.netRevenue),
    adSpend: Math.round(r.adSpend),
    profit: Math.round(r.contributionProfit),
  }));
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickLine={false} axisLine={false}
            tickFormatter={(v: number) => shortKrw(v)}
          />
          <Tooltip
            formatter={(v: number, name: string) => {
              const label = name === "netRevenue" ? "순거래액"
                          : name === "adSpend" ? "광고비"
                          : name === "profit" ? "기여이익"
                          : name;
              return [`${KRW.format(v)} 원`, label];
            }}
            labelStyle={{ color: "#6b7280", fontSize: 12 }}
            contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
          <Bar dataKey="netRevenue" fill="#e5e7eb" />
          <Bar dataKey="adSpend" fill="#fda4af" />
          <Line type="monotone" dataKey="profit" stroke="#0f766e" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ROAS vs Break-even chart
// ────────────────────────────────────────────────────────────────────────────

function RoasChart({ rows }: { rows: DailyRow[] }) {
  const data = rows
    .filter((r) => r.adSpend > 0)
    .map((r) => ({
      date: r.date,
      roas: r.roas !== null ? Number(r.roas.toFixed(1)) : null,
      breakEven: r.breakEvenRoas !== null ? Number(r.breakEvenRoas.toFixed(1)) : null,
    }));

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">광고비가 집행된 일자가 없습니다.</p>;
  }
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <Tooltip formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name === "roas" ? "ROAS" : "손익분기"]} />
          <Line type="monotone" dataKey="roas" stroke="#0f766e" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="breakEven" stroke="#fb7185" strokeWidth={2} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cost breakdown (waterfall-style stacked bar)
// ────────────────────────────────────────────────────────────────────────────

function CostBreakdown({ totals }: { totals?: ProfitTotals }) {
  if (!totals) {
    return <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>;
  }
  const items = [
    { label: "VAT", value: totals.vat, color: "bg-slate-300" },
    { label: "PG 수수료", value: totals.pgFee, color: "bg-violet-300" },
    { label: "보고서 ASP", value: totals.reportCost, color: "bg-amber-300" },
    { label: "광고비", value: totals.adSpend, color: "bg-rose-300" },
  ];
  const totalCost = items.reduce((a, b) => a + b.value, 0);
  const profit = totals.contributionProfit;
  const profitPositive = profit >= 0;

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        순거래액 <span className="font-medium text-gray-900">{fmtKrw(totals.netRevenue)} 원</span>
      </div>
      <div className="space-y-2">
        {items.map((it) => {
          const pct = totals.netRevenue > 0 ? (it.value / totals.netRevenue) * 100 : 0;
          return (
            <div key={it.label} className="flex items-center gap-3">
              <div className="w-20 text-xs text-gray-500">{it.label}</div>
              <div className="flex-1 h-3 rounded bg-gray-100">
                <div className={`h-3 rounded ${it.color}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="w-24 text-right text-xs text-gray-700">{fmtKrw(it.value)} 원</div>
              <div className="w-12 text-right text-xs text-gray-400">{pct.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">총 비용</span>
          <span className="font-medium text-gray-900">{fmtKrw(totalCost)} 원</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-gray-500">기여이익</span>
          <span className={`font-semibold ${profitPositive ? "text-emerald-600" : "text-rose-600"}`}>
            {fmtKrw(profit)} 원
          </span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Campaign table
// ────────────────────────────────────────────────────────────────────────────

function CampaignTable({ campaigns, loading, error }: {
  campaigns: CampaignRow[]; loading: boolean; error: string | null;
}) {
  if (error) {
    return <p className="py-8 text-center text-sm text-amber-700">{error}</p>;
  }
  if (!loading && campaigns.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">광고 캠페인 데이터가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="py-2 pr-4 font-medium">캠페인</th>
            <th className="py-2 pr-4 text-right font-medium">광고비</th>
            <th className="py-2 pr-4 text-right font-medium">노출</th>
            <th className="py-2 pr-4 text-right font-medium">클릭</th>
            <th className="py-2 pr-4 text-right font-medium">CTR</th>
            <th className="py-2 text-right font-medium">CPC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {campaigns.slice(0, 20).map((c) => (
            <tr key={c.campaignId} className="text-gray-700">
              <td className="py-2 pr-4">
                <div className="truncate max-w-[260px]" title={c.campaignName}>{c.campaignName}</div>
                <div className="text-[10px] text-gray-400">{c.campaignId}</div>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtKrw(c.spend)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{KRW.format(c.impressions)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{KRW.format(c.clicks)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(c.ctr, 2)}</td>
              <td className="py-2 text-right tabular-nums">{c.cpc !== null ? fmtKrw(c.cpc) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Daily table
// ────────────────────────────────────────────────────────────────────────────

function DailyTable({ rows, loading }: { rows: DailyRow[]; loading: boolean }) {
  if (!loading && rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>;
  }
  // 최신 일자가 위. 최대 30 줄.
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="py-2 pr-3 font-medium">날짜</th>
            <th className="py-2 pr-3 text-right font-medium">순거래액</th>
            <th className="py-2 pr-3 text-right font-medium">광고비</th>
            <th className="py-2 pr-3 text-right font-medium">기여이익</th>
            <th className="py-2 pr-3 text-right font-medium">마진</th>
            <th className="py-2 text-right font-medium">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((r) => {
            const profitColor = r.contributionProfit > 0 ? "text-emerald-600"
                              : r.contributionProfit < 0 ? "text-rose-600"
                              : "text-gray-500";
            return (
              <tr key={r.date} className="text-gray-700">
                <td className="py-2 pr-3 font-mono text-xs">{r.date}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.netRevenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.adSpend)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-medium ${profitColor}`}>
                  {fmtKrw(r.contributionProfit)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.contributionMargin)}</td>
                <td className="py-2 text-right tabular-nums">{fmtPct(r.roas, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Insight panel
// ────────────────────────────────────────────────────────────────────────────

function InsightPanel({
  totals, daily, settings,
}: {
  totals?: ProfitTotals;
  daily: DailyRow[];
  settings?: { pgFeeRate: number; reportCostPerUnit: number };
}) {
  if (!totals) {
    return <p className="py-8 text-center text-sm text-gray-400">데이터 없음</p>;
  }

  // 가장 수익률 좋은 날 / 가장 손실 큰 날.
  const sortedByProfit = [...daily].sort((a, b) => b.contributionProfit - a.contributionProfit);
  const bestDay = sortedByProfit[0];
  const worstDay = sortedByProfit[sortedByProfit.length - 1];

  const lines: Array<{ tone: "good" | "warn" | "info"; text: string }> = [];

  if (totals.status === "흑자") {
    lines.push({
      tone: "good",
      text: `기여이익 +${fmtKrw(totals.contributionProfit)}원 (마진 ${fmtPct(totals.contributionMargin)}) — 흑자 구조입니다.`,
    });
  } else if (totals.status === "적자") {
    lines.push({
      tone: "warn",
      text: `기여이익 ${fmtKrw(totals.contributionProfit)}원 (마진 ${fmtPct(totals.contributionMargin)}) — 적자입니다.`,
    });
  } else {
    lines.push({ tone: "info", text: "기여이익이 손익분기 부근입니다." });
  }

  if (totals.adSpend > 0 && totals.roas !== null && totals.breakEvenRoas !== null) {
    if (totals.adAdvice === "증액 가능") {
      lines.push({
        tone: "good",
        text: `ROAS ${fmtPct(totals.roas, 0)} > 손익분기 ${fmtPct(totals.breakEvenRoas, 0)} — 광고 증액 여력이 있습니다.`,
      });
    } else if (totals.adAdvice === "광고비 주의") {
      lines.push({
        tone: "warn",
        text: `ROAS ${fmtPct(totals.roas, 0)} ≤ 손익분기 ${fmtPct(totals.breakEvenRoas, 0)} — 광고비를 줄이거나 소재/타겟 점검이 필요합니다.`,
      });
    }
  } else if (totals.adSpend <= 0) {
    lines.push({ tone: "info", text: "광고비 집행이 없어 ROAS 가 계산되지 않았습니다." });
  }

  if (bestDay && bestDay.contributionProfit > 0) {
    lines.push({
      tone: "info",
      text: `가장 수익 좋은 날: ${bestDay.date} (+${fmtKrw(bestDay.contributionProfit)}원)`,
    });
  }
  if (worstDay && worstDay.contributionProfit < 0 && worstDay.date !== bestDay?.date) {
    lines.push({
      tone: "warn",
      text: `가장 손실 큰 날: ${worstDay.date} (${fmtKrw(worstDay.contributionProfit)}원)`,
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              l.tone === "good" ? "bg-emerald-500"
              : l.tone === "warn" ? "bg-rose-500"
              : "bg-gray-400"
            }`} />
            <span className={`${
              l.tone === "good" ? "text-emerald-700"
              : l.tone === "warn" ? "text-rose-700"
              : "text-gray-600"
            }`}>{l.text}</span>
          </li>
        ))}
      </ul>
      {settings && (
        <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-400">
          PG {(settings.pgFeeRate * 100).toFixed(2)}% · 보고서 {fmtKrw(settings.reportCostPerUnit)}원/건
        </div>
      )}
    </div>
  );
}
