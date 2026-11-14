"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelsData } from "./dash/ui";
import RevenueSources from "./dash/RevenueSources";
import Trend30, { Trend30Placeholder } from "./dash/Trend30";
import AdVerdict from "./dash/AdVerdict";
import SetSales from "./SetSales";
import { TXT } from "./dash/ui";
import KpiCards from "./dash/KpiCards";
import { presetOf, presetRange, sameTimeRevenue, type PresetKey } from "@/lib/dashboard-view";

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
  extraAdSpend?: number;   // 광고비 중 메타 외(네이버, 켰으면 시딩·브랜딩. 월 일할) (lib/manual-costs.ts)
};

// 광고비 카드 내역 (summary API + 화면 스위치 상태). 시딩·브랜딩은 marketingIncluded 일 때만 광고비 합계에 들어 있다.
type AdBreakdown = { meta: number; naver: number; seeding: number; branding: number; server?: number; marketingIncluded: boolean };

type SummaryData = {
  range: { from: string; until: string };
  fetchedAt: string;
  settings: { pgFeeRate: number; reportCostPerUnit: number };
  totals: ProfitTotals;
  totalsWithMarketing?: ProfitTotals;   // 시딩·브랜딩 포함 (스위치 켜짐)
  adBreakdown?: Omit<AdBreakdown, "marketingIncluded">;
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
  dailyWithMarketing?: DailyRow[];      // 시딩·브랜딩 포함 (스위치 켜짐)
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

/**
 * '시딩·브랜딩 포함' 버튼 상태. 기본은 꺼짐 = 광고비는 메타 + 네이버만 (매일 광고 효율용).
 * 켜면 시딩·브랜딩(그 달 일수로 나눔)을 광고비에 더한다 — 월말 종합 손익용. 브라우저에 기억.
 * 서버가 두 벌을 같이 보내므로 켜고 끌 때 다시 불러오지 않는다.
 */
function useIncludeMarketing(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setOn(localStorage.getItem("rmsf_marketing") === "1");
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem("rmsf_marketing", on ? "1" : "0");
    } catch {}
  }, [on, ready]);
  const toggle = useCallback(() => setOn((prev) => !prev), []);
  return [on, toggle];
}

// ────────────────────────────────────────────────────────────────────────────
// Formatters / helpers
// ────────────────────────────────────────────────────────────────────────────

const NUM = new Intl.NumberFormat("ko-KR");

// 오늘 = KST 날짜 (API 의 from/until 이 KST 라 서버(UTC)·브라우저 시간대와 무관하게 맞춤.)
function todayStr(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// 응답 시각(ISO)의 KST 날짜
function kstDateOf(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return new Date((Number.isFinite(t) ? t : Date.now()) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// 하루짜리 기간이 응답 시점의 KST 오늘이면 진행 중
function isLiveRange(r: { from: string; until: string }, fetchedAt: string | undefined): boolean {
  return r.from === r.until && r.until >= kstDateOf(fetchedAt);
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
function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard root
// ────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  // 기본 = 오늘 (진행 중인 날은 광고 판정이 판정을 보류). 두 날짜는 같은 '오늘'에서.
  const [range, setRange] = useState(() => presetRange("today", todayStr()));
  const { from, until } = range;
  const setFrom = (f: string) => setRange((r) => ({ ...r, from: f }));
  const setUntil = (u: string) => setRange((r) => ({ ...r, until: u }));
  const [payments, setPayments] = useState<PaymentsData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [daily, setDaily] = useState<DailyData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null);
  const [prevDaily, setPrevDaily] = useState<{ days: number; off: DailyRow[]; on: DailyRow[] } | null>(null);
  const [channels, setChannels] = useState<ChannelsData | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<{ off: DailyRow[]; on: DailyRow[] } | null>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [includeMarketing, toggleMarketing] = useIncludeMarketing();

  // 스위치에 맞는 쪽을 고른다 (서버가 시딩·브랜딩 제외·포함 두 벌을 보냄. 계산은 서버, 화면은 선택만)
  const summaryView = useMemo(() => {
    if (!summary) return null;
    const totals = includeMarketing && summary.totalsWithMarketing ? summary.totalsWithMarketing : summary.totals;
    const adBreakdown = summary.adBreakdown ? { ...summary.adBreakdown, marketingIncluded: includeMarketing } : undefined;
    return { ...summary, totals, adBreakdown };
  }, [summary, includeMarketing]);
  const dailyView = useMemo(() => {
    if (!daily) return null;
    return includeMarketing && daily.dailyWithMarketing ? { ...daily, daily: daily.dailyWithMarketing } : daily;
  }, [daily, includeMarketing]);
  const prevTotals = useMemo<PrevTotals | null>(() => {
    if (!prevDaily) return null;
    const rows = includeMarketing ? prevDaily.on : prevDaily.off;
    return {
      days: prevDaily.days,
      netRevenue: rows.reduce((a, r) => a + r.netRevenue, 0),
      adSpend: rows.reduce((a, r) => a + r.adSpend, 0),
      pgFee: rows.reduce((a, r) => a + r.pgFee, 0),
      reportCost: rows.reduce((a, r) => a + r.reportCost, 0),
      contributionProfit: rows.reduce((a, r) => a + r.contributionProfit, 0),
    };
  }, [prevDaily, includeMarketing]);
  const channelsView = useMemo(() => {
    if (!channels || !includeMarketing) return channels;
    const pick = <T extends { mer: number | null; adSpend: number; merWithMarketing?: number | null; adSpendWithMarketing?: number }>(c: T | null) =>
      c && c.merWithMarketing !== undefined ? { ...c, mer: c.merWithMarketing, adSpend: c.adSpendWithMarketing ?? c.adSpend } : c;
    return { ...channels, cur: pick(channels.cur), prev: pick(channels.prev) };
  }, [channels, includeMarketing]);
  // 오늘 보기일 때만 어제 같은 시각 매출을 따로 불러온다 (결제매출 카드 비교용).
  // live 는 화면에 떠 있는 summary 의 기간 기준 (기간을 바꾼 직후 옛 숫자에 오늘 문구가 붙지 않게).
  // 판단 기준은 응답이 만들어진 시각의 KST 날짜 (탭을 밤새 열어 둬도 어제 일부만 모인 숫자를 완료로 보지 않게).
  const live = Boolean(summary) && isLiveRange(summary!.range, summary!.fetchedAt);
  // 방금 고른 기간과 화면의 summary 기간이 다르면 불러오는 동안 옛 숫자를 흐리게 보인다.
  const stale = Boolean(summary) && (summary!.range.from !== from || summary!.range.until !== until);
  const [yesterdaySameTime, setYesterdaySameTime] = useState<number | null>(null);
  useEffect(() => {
    if (!live) { setYesterdaySameTime(null); return; }
    let stale = false;
    const y = presetRange("yesterday", todayStr()).from;
    fetch(`/api/payments?from=${y}&until=${y}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (stale || !Array.isArray(j?.hourly)) return;
        const kst = new Date(Date.now() + 9 * 3600 * 1000);
        setYesterdaySameTime(sameTimeRevenue(j.hourly, kst.getUTCHours(), kst.getUTCMinutes()));
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [live, summary]); // 새로고침마다 summary 가 새로 와서 어제 같은 시각을 현재 시각으로 다시 계산

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

    // 채널 성과는 Mixpanel 조회가 붙어 다른 카드보다 늦을 수 있어 따로 기다린다.
    setChannelsLoading(true);
    fetch(`/api/dashboard/channels?${q}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (reqIdRef.current !== myId) return;
        setChannels(res.ok ? json : { range: { from, until }, prevRange: null, clampedFrom: null, cur: null, prev: null, error: json?.detail || json?.error || `channels HTTP ${res.status}` });
      })
      .catch((e) => {
        if (reqIdRef.current === myId) setChannels({ range: { from, until }, prevRange: null, clampedFrom: null, cur: null, prev: null, error: String(e?.message || e) });
      })
      .finally(() => {
        if (reqIdRef.current === myId) setChannelsLoading(false);
      });

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
      else setError(sJson?.detail || sJson?.error || `summary HTTP ${sRes.status}`);
      if (dRes.ok) setDaily(dJson);
      setCampaigns(cRes.ok ? cJson : null);
      if (prevRes.ok && Array.isArray(prevJson?.daily)) {
        setPrevDaily({ days: len, off: prevJson.daily, on: prevJson.dailyWithMarketing ?? prevJson.daily });
      } else {
        setPrevDaily(null);
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

  // 최근 30일 추이는 고른 기간과 무관하므로 기간 변경에 다시 받지 않고, 처음 열 때와 새로고침 때만 받는다.
  // 기간 요청의 stale 가드와 따로 두어 기간을 바꿔도 추이 응답이 버려지지 않는다.
  const trendReqRef = useRef(0);
  const loadTrend = useCallback((force = false) => {
    const myId = ++trendReqRef.current;
    const tr = presetRange("month30", todayStr());
    const tq = new URLSearchParams({ from: tr.from, until: tr.until });
    if (force) tq.set("force", "1");
    setTrendLoading(true);
    fetch(`/api/dashboard/daily?${tq}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (trendReqRef.current !== myId) return;
        if (res.ok && Array.isArray(json?.daily)) setTrend({ off: json.daily, on: json.dailyWithMarketing ?? json.daily });
      })
      .catch(() => {})
      .finally(() => { if (trendReqRef.current === myId) setTrendLoading(false); });
  }, []);

  useEffect(() => {
    loadTrend(false);
    return () => { trendReqRef.current++; };
  }, [loadTrend]);

  const refresh = () => { load(true); loadTrend(true); };
  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    location.href = "/login";
  };

  const metaError = summaryView?.metaError || dailyView?.metaError || campaigns?.metaError || null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Header
        fetchedAt={payments?.fetchedAt}
        cached={Boolean(payments?.cached && summaryView?.cached && dailyView?.cached)}
        theme={theme}
        onToggleTheme={toggleTheme}
        from={from} until={until}
        loading={loading}
        onRefresh={refresh}
      />

      <FilterBar
        from={from} until={until}
        setFrom={setFrom} setUntil={setUntil}
        loading={loading}
        onRefresh={refresh}
        onLogout={logout}
      />

      {error && (
        <Banner tone="error" title="데이터 로드 실패" body={error} />
      )}
      {metaError && (
        <Banner tone="warn" title="광고 데이터 알림" body={metaError} />
      )}

      {/* ── 1. 상단 KPI 스트립 ─────────────────────────────────────────── */}
      <KpiCards
        totals={summaryView?.totals}
        adBreakdown={summaryView?.adBreakdown}
        daily={dailyView?.daily ?? []}
        prev={prevTotals}
        live={live}
        stale={stale}
        yesterdaySameTime={yesterdaySameTime}
        prevDays={prevTotals?.days ?? 0}
        marketingSwitch={<MarketingSwitch on={includeMarketing} onToggle={toggleMarketing} />}
      />

      {/* ── 1-1. 광고 판정 ─────────────── */}
      <AdVerdict
        data={channelsView}
        campaigns={campaigns}
        loading={channelsLoading}
        live={Boolean(channelsView?.cur) && isLiveRange(channelsView!.cur!.range, channelsView!.fetchedAt)}
        asOf={channelsView?.fetchedAt ?? summary?.fetchedAt ?? null}
        theme={theme}
      />

      <RevenueSources data={channelsView} loading={channelsLoading} theme={theme} />

      {trend
        ? <Trend30 rows={includeMarketing ? trend.on : trend.off} theme={theme} />
        : <Trend30Placeholder loading={trendLoading} />}

      {/* ── 1-2. 세트 판매 (채널 성과와 같은 결제·귀속 데이터) ───────────────── */}
      {channelsView?.cur?.sets && (
        <div className="mt-6">
          <CollapsibleCard
            title="세트 판매"
            subtitle={`세트 ${channelsView!.cur!.sets.n.toLocaleString("ko-KR")}건`}
            defaultOpen={false}
          >
            <SetSales sets={channelsView!.cur!.sets} theme={theme} />
          </CollapsibleCard>
        </div>
      )}

      {/* ── 4. 하단 상세 (접기 가능) ────────────────────────────────────── */}
      <div className="mt-6 space-y-4 md:mt-8">
        <CollapsibleCard title="일별 손익 표" defaultOpen={false}>
          <DailyTable rows={dailyView?.daily ?? []} loading={loading} />
        </CollapsibleCard>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 md:mt-8">
        <p className="min-w-0 flex-1 text-xs text-gray-500 dark:text-zinc-400">
          데이터 출처: 결제 토스페이먼츠(6/18 이전 PortOne), 광고 Meta Marketing API, 유입 Mixpanel. Google Play 인앱결제는 포함하지 않습니다.
        </p>
        <button type="button" onClick={logout} className={`-mr-2 flex min-h-11 shrink-0 items-center px-2 text-xs underline md:hidden ${TXT.dim}`}>로그아웃</button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Layout pieces
// ────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 날짜 문자열을 UTC 로 읽어 브라우저 시간대와 무관하게 요일을 구함
function mdWd(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAYS[d.getUTCDay()]})`;
}

function periodDescription(from: string, until: string, kstTime: string): string {
  const today = todayStr();
  if (from === today && until === today) {
    return `${mdWd(today)}${kstTime ? ` ${kstTime}` : ""} 기준, 진행 중. 비교는 어제 같은 시각`;
  }
  // 오늘이 끼면 오늘은 미완료라 완료 일수에서 뺀다
  const n = diffDays(from, until) - (until >= today && from <= today ? 1 : 0);
  const span = from === until ? mdWd(from) : `${mdWd(from)} – ${mdWd(until)}`;
  return `${span}, 완료된 ${n}일. 화살표는 이전 ${diffDays(from, until)}일 대비`;
}

const ctrlBtn = `flex min-h-11 w-full items-center justify-center rounded-lg border border-[#E3E8EE] bg-white px-3 text-sm hover:bg-gray-50 md:min-h-10 md:w-auto dark:border-[#232836] dark:bg-[#12151C] dark:hover:bg-[#1A1F2A] ${TXT.sub}`;
const iconBtn = `flex h-11 w-11 items-center justify-center rounded-lg border border-[#E3E8EE] bg-white hover:bg-gray-50 dark:border-[#232836] dark:bg-[#12151C] dark:hover:bg-[#1A1F2A] ${TXT.sub}`;

function ThemeIcon({ theme, className }: { theme: Theme; className: string }) {
  return theme === "dark" ? (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ) : (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function RefreshIcon({ spinning, className }: { spinning: boolean; className: string }) {
  return (
    <svg className={`${className} ${spinning ? "animate-spin" : ""}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
    </svg>
  );
}

function Header({
  fetchedAt, cached, theme, onToggleTheme, from, until, loading, onRefresh,
}: {
  fetchedAt?: string; cached?: boolean; theme: Theme; onToggleTheme: () => void;
  from: string; until: string; loading: boolean; onRefresh: () => void;
}) {
  // 서버·브라우저 렌더 불일치를 피하려고 마운트 뒤에 KST 시각을 채움
  const [kstTime, setKstTime] = useState("");
  useEffect(() => {
    const tick = () => setKstTime(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  const themeLabel = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";
  return (
    <div className="mb-4 md:flex md:items-end md:justify-between md:gap-3">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className={`text-xl font-extrabold tracking-tight ${TXT.main}`}>푸리 재무</h1>
          {/* 휴대폰: 새로고침과 테마 전환을 아이콘 버튼으로 (업데이트 시각은 아래 설명줄에 합침) */}
          <div className="flex gap-2 md:hidden">
            <button type="button" onClick={onRefresh} disabled={loading} aria-label={loading ? "불러오는 중" : "새로고침"} className={`${iconBtn} disabled:opacity-50`}>
              <RefreshIcon spinning={loading} className="h-5 w-5" />
            </button>
            <button type="button" onClick={onToggleTheme} aria-label={themeLabel} className={iconBtn}>
              <ThemeIcon theme={theme} className="h-5 w-5" />
            </button>
          </div>
        </div>
        <p className={`mt-1 text-[13px] md:text-sm ${TXT.sub}`}>{periodDescription(from, until, kstTime)}</p>
      </div>
      <div className={`hidden flex-wrap items-center gap-2 text-xs md:flex ${TXT.dim}`}>
        {fetchedAt && <span>업데이트 {new Date(fetchedAt).toLocaleString("ko-KR")}</span>}
        {cached && <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-zinc-800">cached</span>}
        <button type="button" onClick={onToggleTheme} aria-label={themeLabel} className={`${ctrlBtn} !w-10 px-0`}>
          <ThemeIcon theme={theme} className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

const PRESETS: [PresetKey, string][] = [
  ["today", "오늘"], ["yesterday", "어제"], ["week", "7일"], ["month30", "30일"],
  ["thisMonth", "이번 달"], ["lastMonth", "지난 달"], ["all", "전체"],
];

function FilterBar({
  from, until, setFrom, setUntil, loading, onRefresh, onLogout,
}: {
  from: string; until: string;
  setFrom: (s: string) => void; setUntil: (s: string) => void;
  loading: boolean; onRefresh: () => void; onLogout: () => void;
}) {
  const today = todayStr();
  const current = presetOf(from, until, today);
  // 휴대폰: '직접'을 누르면 날짜 입력이 펼쳐진다. 고른 기간이 프리셋이 아니어도 '직접'이 선택 표시.
  const [customOpen, setCustomOpen] = useState(false);
  const directOn = customOpen || current === null;
  const dateBox = `flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-lg border border-[#E3E8EE] bg-white px-2 py-1 text-xs md:min-h-10 md:flex-row md:items-center md:gap-2 md:py-0 dark:border-[#232836] dark:bg-[#12151C] ${TXT.dim}`;
  const dateInput = "min-w-0 flex-1 bg-transparent text-base md:text-xs outline-none dark:[color-scheme:dark]";
  const selected = "!border-[#0D1B2A] !bg-[#0D1B2A] !text-white dark:!border-[#262C3B] dark:!bg-[#262C3B] dark:!text-[#ECEEF2]";
  return (
    <div className="mb-6 grid grid-cols-4 gap-2 md:flex md:flex-wrap md:items-center">
      {PRESETS.map(([key, label]) => {
        const on = current === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => { const r = presetRange(key, today); setFrom(r.from); setUntil(r.until); setCustomOpen(false); }}
            className={`${ctrlBtn} ${on ? selected : ""}`}
          >
            {label}
          </button>
        );
      })}
      <button type="button" aria-expanded={directOn} aria-controls="custom-range" aria-pressed={current === null} onClick={() => setCustomOpen((o) => !o)} className={`${ctrlBtn} md:hidden ${current === null ? selected : ""}`}>직접</button>
      <div className="hidden grow md:block" />
      <div id="custom-range" className={`col-span-4 grid-cols-2 gap-2 md:contents ${directOn ? "grid" : "hidden"}`}>
        <label className={dateBox}>
          <span>시작</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateInput} />
        </label>
        <label className={dateBox}>
          <span>종료</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={dateInput} />
        </label>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading}
        className="hidden min-h-10 items-center gap-2 rounded-lg bg-portone px-4 text-sm font-medium text-white hover:bg-portone-600 disabled:opacity-50 md:flex">
        <RefreshIcon spinning={loading} className="h-4 w-4" />
        {loading ? "불러오는 중…" : "새로고침"}
      </button>
      <button type="button" onClick={onLogout} className={`${ctrlBtn} hidden !text-xs md:flex`}>로그아웃</button>
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

function CollapsibleCard({
  title, subtitle, defaultOpen, children,
}: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-[#E3E8EE] bg-white dark:border-[#232836] dark:bg-[#12151C]">
      <summary className="flex cursor-pointer items-center justify-between min-h-[52px] px-4 py-3 text-sm font-semibold md:px-5 md:py-4 text-[#0D1B2A] dark:text-[#ECEEF2]">
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {subtitle && <span className="rounded-full bg-[#EEF1F5] px-2 py-0.5 text-xs font-normal text-[#4B5565] dark:bg-[#1C2130] dark:text-[#A3AAB8]">{subtitle}</span>}
        </div>
        <svg className="h-4 w-4 text-[#6B7280] transition group-open:rotate-180 dark:text-[#8A92A3]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="border-t border-[#EEF1F5] px-4 py-4 md:px-5 dark:border-[#1C2130]">{children}</div>
    </details>
  );
}

/**
 * 광고비 카드 안의 '시딩, 브랜딩 포함' 스위치. 켜면 시딩과 브랜딩 비용(그 달 일수로 나눔)이 광고비에 들어가고
 * MER·공헌이익·일별 표·채널 성과 MER 도 같이 바뀐다. 끄면 메타 + 네이버 광고비만 (매일 광고 효율용).
 */
function MarketingSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="시딩과 브랜딩 포함"
      onClick={onToggle}
      title="켜면 시딩과 브랜딩 비용(그 달 일수로 나눔)을 광고비에 포함합니다. MER·공헌이익도 같이 바뀝니다."
      className={`mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${on ? "text-violet-700 dark:text-violet-300" : TXT.sub}`}
    >
      <span aria-hidden="true" className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-violet-500" : "bg-gray-300 dark:bg-zinc-600"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span aria-hidden="true" className="whitespace-nowrap"><span className="md:hidden">시딩, 브랜딩</span><span className="hidden md:inline">시딩과 브랜딩 포함</span></span>
    </button>
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
            <th className="py-2 pr-3 text-right font-medium">건수</th>
            <th className="py-2 pr-3 text-right font-medium">순매출</th>
            <th className="py-2 pr-3 text-right font-medium">광고비</th>
            <th className="py-2 pr-3 text-right font-medium">공헌이익</th>
            <th className="py-2 pr-3 text-right font-medium">마진</th>
            <th className="py-2 text-right font-medium">MER</th>
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
              <tr key={r.date} className={`${belowBep && !isToday ? "bg-rose-50/40 dark:bg-rose-950/20" : ""} ${isToday ? "text-gray-400 dark:text-zinc-500" : "text-gray-700 dark:text-zinc-300"}`}>
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.date}{isToday && <span className="ml-1 text-xs">(당일)</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{NUM.format(r.reportCount)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.netRevenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtKrw(r.adSpend)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-medium ${isToday ? "" : profitColor}`}>
                  {fmtKrw(r.contributionProfit)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.contributionMargin)}</td>
                <td className={`py-2 text-right tabular-nums ${belowBep && !isToday ? "text-rose-600 font-medium dark:text-rose-400" : ""}`}>
                  {fmtPct(r.roas, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-500 dark:text-zinc-400">※ MER(전체 매출 ÷ 광고비)이 손익분기 미만인 행은 옅은 적색 배경 · 당일(미완료) 은 회색</p>
    </div>
  );
}
