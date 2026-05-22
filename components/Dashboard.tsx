"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DashboardData = {
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

export default function Dashboard() {
  const [from, setFrom] = useState<string>(() => "2026-01-01");
  const [until, setUntil] = useState<string>(() => today());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"weekly" | "daily">("weekly");

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, until });
      if (force) qs.set("force", "1");
      const res = await fetch(`/api/payments?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.detail || j?.error || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      setData(j);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [from, until]);

  useEffect(() => {
    load(false);
  }, [load]);

  const chartData = useMemo(() => {
    if (!data) return [];
    if (granularity === "weekly") {
      return data.weekly.map((w) => ({ x: w.weekStart, y: w.gross }));
    }
    return data.daily.map((d) => ({ x: d.date, y: d.gross }));
  }, [data, granularity]);

  const topChannels = data?.byChannel.slice(0, 5) ?? [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">결제 대시보드</h1>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {data?.fetchedAt && <span>업데이트 {new Date(data.fetchedAt).toLocaleString("ko-KR")}</span>}
          {data?.cached && <span className="rounded bg-gray-100 px-2 py-0.5">cached</span>}
        </div>
      </div>

      {/* 필터 + 새로고침 */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <span className="text-gray-500">시작</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent outline-none"
          />
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <span className="text-gray-500">종료</span>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="bg-transparent outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => { setFrom("2026-01-01"); setUntil(today()); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          전체 기간
        </button>
        <button
          type="button"
          onClick={() => { setFrom(daysAgo(29)); setUntil(today()); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          최근 30일
        </button>
        <button
          type="button"
          onClick={() => { setFrom(daysAgo(6)); setUntil(today()); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          최근 7일
        </button>
        <div className="grow" />
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-portone px-4 py-2 text-sm font-medium text-white hover:bg-portone-600 disabled:opacity-50"
          title="PortOne API 재호출 (캐시 무시)"
        >
          <svg
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
        <button
          type="button"
          onClick={async () => { await fetch("/api/auth", { method: "DELETE" }); location.href = "/login"; }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 hover:bg-gray-50"
        >
          로그아웃
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPI 3 카드 */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="거래액" value={data?.gross ?? 0} accent="black" />
        <KpiCard label="순거래액" value={data?.netRevenue ?? 0} accent="black" />
        <KpiCard label="거래취소액" value={data?.cancelled ?? 0} accent="black" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 그래프 */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">거래액 그래프</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {data ? `${diffDays(data.range.from, data.range.until)}일간` : "-"}
              </span>
            </div>
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
          </div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : KRW.format(v))}
                />
                <Tooltip
                  formatter={(v: number) => [KRW.format(v) + " 원", "거래액"]}
                  labelStyle={{ color: "#6b7280", fontSize: 12 }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="#FF6F0F"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 결제수단별 TOP5 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">결제수단별 순거래액 TOP5</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {data ? `${diffDays(data.range.from, data.range.until)}일간` : "-"}
            </span>
          </div>
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
                  <div className="text-xs text-gray-500">{KRW.format(Math.round(c.net))}</div>
                </div>
                <div className="w-14 rounded-md bg-portone-50 px-2 py-1 text-right text-xs font-medium text-portone-600">
                  {c.pct.toFixed(1)}%
                </div>
                <div className="hidden h-2 flex-1 max-w-[120px] rounded bg-portone-50 md:block">
                  <div
                    className="h-2 rounded bg-portone"
                    style={{ width: `${Math.min(100, c.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 건수 / 결제완료 정보 */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <InfoCard
          label="결제완료"
          value={`${KRW.format(data?.paidCount ?? 0)} 건`}
          hint="PortOne status = PAID"
        />
        <InfoCard
          label="환불/취소 발생"
          value={`${KRW.format(data?.cancelCount ?? 0)} 건`}
          hint="amount.cancelled > 0"
        />
      </div>

      <p className="mt-8 text-xs text-gray-400">
        데이터 출처: PortOne V2 API · Google Play 등 인앱결제는 본 대시보드에 포함되지 않음
      </p>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: "black" | "orange" }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-2 text-sm text-gray-500">{label}</div>
      <div className={`text-3xl font-bold ${accent === "orange" ? "text-portone" : "text-gray-900"}`}>
        {KRW.format(Math.round(value))}
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
