"use client";

/**
 * 채널 성과 섹션 — 토스 매출을 Mixpanel 유입 경로로 나눠 메타(인스타 포함) ROAS 를 객관적으로 보여준다.
 *
 * 화면 순서 (2026-10-10 시안 확정, 역피라미드):
 *   ① 메타 광고, 지금 돈 버나요?  — 메타 귀속 ROAS 히어로 + 손익분기 트랙 + MER·aMER·nCAC·픽셀 ROAS
 *   ② 매출은 어디서 나오나요?      — 100% 채널 막대 + 범례 + 광고/광고 외/미귀속 + 일별 누적 막대
 *   ③ 어느 캠페인을 키울까요?      — 채널·캠페인 표 (모바일은 카드)
 *
 * 숫자는 모두 /api/dashboard/channels 가 lib/calc.ts 로 계산해 준 값. 여기선 비율·표시만 한다.
 * 채널 색은 dataviz 범주색 1~5번 + 회색(미귀속), 라이트·다크 각각 색각 검증 통과(2026-10-10).
 */
import { useMemo, useState } from "react";
import { commonCampaignPrefix } from "@/lib/campaign-name";
import type { ChannelGroup } from "@/lib/channel";
import type { ChannelDaily, ChannelGroupRow, ChannelPeriod, ChannelRow } from "@/lib/channel-revenue";

export type ChannelsData = {
  range: { from: string; until: string };
  prevRange: { from: string; until: string } | null;
  clampedFrom: string | null;
  attributionAsOf?: string | null;
  attributionStale?: boolean;
  cur: ChannelPeriod | null;
  prev: ChannelPeriod | null;
  error: string | null;
};

type Theme = "light" | "dark";
type Mode = "all" | "new";

const ORDER: ChannelGroup[] = ["meta", "search", "owned", "influencer", "referral", "unattributed"];
const LABEL: Record<ChannelGroup, string> = {
  meta: "메타 광고", search: "검색", owned: "자사 SNS", influencer: "인플루언서", referral: "레퍼럴", unattributed: "미귀속",
};
const COLORS: Record<Theme, Record<ChannelGroup, string>> = {
  light: { meta: "#2a78d6", search: "#eb6834", owned: "#1baf7a", influencer: "#eda100", referral: "#e87ba4", unattributed: "#b9b7b1" },
  dark: { meta: "#3987e5", search: "#d95926", owned: "#199e70", influencer: "#c98500", referral: "#d55181", unattributed: "#55554f" },
};
const TIPS = {
  roas: "메타 광고로 들어온 고객의 실제 결제액(토스) ÷ 메타 광고비. 결제 직전 마지막 유입 경로(UTM) 기준이에요.",
  aroas: "메타 광고로 들어와 처음 결제한 고객의 결제액 ÷ 메타 광고비. 광고가 새 고객을 데려오는 효율이에요(aMER). 7월 하순 이전 결제 기록은 Mixpanel에 없어서, 그때 산 고객의 재구매는 신규로 잡힐 수 있어요.",
  mer: "전체 매출 ÷ 전체 광고비. 네이버·인스타 프로필 같은 광고 외 매출도 포함돼서 광고 성과보다 높게 나와요.",
  ncac: "메타 광고비 ÷ 메타로 들어온 신규 구매자 수. 새 고객 1명을 데려오는 데 든 비용이에요.",
  pixel: "메타 광고관리자가 자체 집계한 구매액 ÷ 광고비. 7일 클릭·1일 조회 기준이라 실제보다 크게 잡혀요.",
  cov: "결제 중 유입 채널을 확인한 비율. 결제 이벤트에 UTM이 없으면 결제 전 7일 방문기록으로 복원해요.",
};

const NUM = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `₩${NUM.format(Math.round(n))}`;
const man = (n: number) => (Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(2)}억` : `${NUM.format(Math.round(n / 1e4))}만`);
const pct = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(d)}%`);
const fmtDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
// KST 시각. 오늘이 아니면 날짜도 붙인다.
const fmtClock = (iso: string) => {
  const k = new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return `${k.slice(0, 10) === today ? "" : fmtDay(k.slice(0, 10)) + " "}${k.slice(11, 16)}`;
};
const revOf = (o: ChannelRow, mode: Mode) => (mode === "new" ? o.newRev : o.rev);
const cntOf = (o: ChannelRow, mode: Mode) => (mode === "new" ? o.newN : o.n);
const roasOf = (o: ChannelRow, mode: Mode) => (o.spend > 0 ? (revOf(o, mode) / o.spend) * 100 : null);

const CARD = "rounded-xl border border-gray-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900";
const EYEBROW = "text-xs font-semibold text-gray-400 dark:text-zinc-500";

// ── 작은 부품 ──────────────────────────────────────────────────────────────

function Info({ text, label }: { text: string; label: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label={`${label} 정의`}
        className="grid h-4 w-4 place-items-center rounded-full border border-gray-300 text-[10px] font-bold leading-none text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:text-zinc-500">
        i
      </button>
      <span role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-60 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block dark:bg-zinc-100 dark:text-zinc-900">
        {text}
      </span>
    </span>
  );
}

function Delta({ cur, prev, inverse = false, ratio = false }: { cur: number | null; prev: number | null | undefined; inverse?: boolean; ratio?: boolean }) {
  if (cur == null || prev == null || (ratio && prev === 0)) return null;
  const diff = ratio ? ((cur - prev) / prev) * 100 : cur - prev;
  if (Math.abs(diff) < 0.05) return <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500">→ 변화 없음</span>;
  const good = inverse ? diff < 0 : diff > 0;
  return (
    <span className={`text-xs font-bold tabular-nums ${good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}{ratio ? "%" : "%p"}
    </span>
  );
}

const TONE = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400",
  warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
  bad: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400",
};
const toneOf = (d: number) => (d >= 5 ? "good" : d >= 0 ? "warn" : "bad");

function StatusChip({ roas, bep }: { roas: number | null; bep: number }) {
  if (roas == null) return <span className="text-xs text-gray-400 dark:text-zinc-500">광고비 없음</span>;
  const d = roas - bep;
  const tone = toneOf(d);
  const text = tone === "good" ? `✔ +${d.toFixed(0)}%p` : tone === "warn" ? `▲ +${d.toFixed(0)}%p 근접` : `✖ ${d.toFixed(0)}%p 미달`;
  return <span className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-bold ${TONE[tone]}`}>{text}</span>;
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-zinc-800">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            value === v ? "bg-white font-bold text-gray-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-gray-500 hover:text-gray-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function useShortNames(rows: ChannelRow[]) {
  const prefix = useMemo(() => commonCampaignPrefix(rows.filter((r) => r.campaignId).map((r) => r.name)), [rows]);
  return (name: string) => (prefix && name.startsWith(prefix) ? name.slice(prefix.length).replace(/^[_\-\s]+/, "") || name : name);
}

// ── ① 히어로 ──────────────────────────────────────────────────────────────

function Kpi({ label, tip, value, delta, sub }: { label: string; tip: string; value: string; delta: React.ReactNode; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3.5 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-zinc-400">{label}<Info text={tip} label={label} /></div>
      <div className="text-[26px] font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-zinc-100">{value}</div>
      <div className="flex flex-wrap items-baseline gap-1.5 text-xs tabular-nums text-gray-400 dark:text-zinc-500">{delta}<span>{sub}</span></div>
    </div>
  );
}

function Hero({ cur, prev, mode, colors }: { cur: ChannelPeriod; prev: ChannelPeriod | null; mode: Mode; colors: Record<ChannelGroup, string> }) {
  const meta = cur.groups[0];
  const isNew = mode === "new";
  const val = isNew ? cur.newCustomerRoas : cur.metaRoas;
  const pval = isNew ? prev?.newCustomerRoas : prev?.metaRoas;
  const bep = cur.metaBreakEvenRoas;
  const scale = (v: number) => (Math.min(Math.max(v, 0), 200) / 200) * 100;
  const d = val != null ? val - bep : null;
  const share = cur.revenue > 0 ? (meta.rev / cur.revenue) * 100 : 0;
  const shortName = useShortNames(meta.children);
  const below = meta.children.filter((k) => k.spend > 0 && (roasOf(k, mode) ?? Infinity) < bep).map((k) => shortName(k.name));
  const verdict = d == null ? null : toneOf(d);

  return (
    <section className={`${CARD} grid gap-4 lg:grid-cols-12`} aria-labelledby="ch-q1">
      <div className="flex flex-col gap-3.5 lg:col-span-5">
        <div className={EYEBROW} id="ch-q1">메타 광고, 지금 돈 버나요?</div>
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-zinc-300">
            {isNew ? "메타 광고 신규 고객 ROAS" : "메타 광고 귀속 ROAS"}
            <Info text={isNew ? TIPS.aroas : TIPS.roas} label="메타 귀속 ROAS" />
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight text-gray-900 sm:text-[56px] sm:leading-none dark:text-zinc-100">{pct(val)}</span>
            <span className="flex items-baseline gap-1">
              <Delta cur={val} prev={pval} />
              {pval != null && <span className="text-xs text-gray-400 dark:text-zinc-500">이전 기간 대비</span>}
            </span>
          </div>
        </div>
        {val != null && (
          <div className="relative pt-5" aria-label={`손익분기 ${pct(bep)} 대비 ${pct(val)}`}>
            <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold tabular-nums text-gray-600 dark:text-zinc-300" style={{ left: `${scale(bep)}%` }}>
              손익분기 {pct(bep)}
            </span>
            <div className="relative h-3 rounded-full bg-gray-100 dark:bg-zinc-800">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${scale(val)}%`, background: d != null && d >= 0 ? colors.meta : "#e11d48" }} />
              <div className="absolute -bottom-1.5 -top-1.5 w-0.5 rounded bg-gray-900 dark:bg-zinc-100" style={{ left: `calc(${scale(bep)}% - 1px)` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-gray-400 dark:text-zinc-500"><span>0%</span><span>100%</span><span>200%</span></div>
          </div>
        )}
        {verdict && d != null && (
          <span className={`w-fit rounded-lg border px-2.5 py-1 text-sm font-bold ${TONE[verdict]}`}>
            {verdict === "good" ? `✔ 손익분기보다 ${d.toFixed(1)}%p 높아요 · 증액 가능`
              : verdict === "warn" ? `▲ 손익분기보다 ${d.toFixed(1)}%p 높아요 · 여유가 작아요`
              : `✖ 손익분기보다 ${Math.abs(d).toFixed(1)}%p 낮아요 · 광고비 주의`}
          </span>
        )}
        <p className="max-w-prose border-t border-gray-100 pt-3.5 text-sm leading-relaxed text-gray-600 dark:border-zinc-800 dark:text-zinc-300">
          이 기간 매출의 <b className="text-gray-900 dark:text-zinc-100">{pct(share)}</b>가 메타 광고에서 나왔어요.{" "}
          {cur.mer != null && cur.metaRoas != null && (
            <>전체 매출로 계산한 MER은 <b className="text-gray-900 dark:text-zinc-100">{pct(cur.mer)}</b>지만, 메타 광고 매출만 보면{" "}
              <b className="text-gray-900 dark:text-zinc-100">{pct(cur.metaRoas)}</b>로 {(cur.mer - cur.metaRoas).toFixed(0)}%p 낮아요.{" "}</>
          )}
          {below.length > 0
            ? <>손익분기 아래 캠페인: <b className="text-gray-900 dark:text-zinc-100">{below.join("·")}</b>.</>
            : "광고비를 쓴 캠페인은 모두 손익분기 이상이에요."}
        </p>
      </div>
      <div className="grid content-start gap-3 sm:grid-cols-2 lg:col-span-7">
        <Kpi label="MER (전체 매출 ÷ 광고비)" tip={TIPS.mer} value={pct(cur.mer)} delta={<Delta cur={cur.mer} prev={prev?.mer} />} sub="회사 전체" />
        {isNew
          ? <Kpi label="메타 귀속 ROAS (전체 고객)" tip={TIPS.roas} value={pct(cur.metaRoas)} delta={<Delta cur={cur.metaRoas} prev={prev?.metaRoas} />} sub={`손익분기 ${pct(bep)}`} />
          : <Kpi label="신규 고객 ROAS (aMER)" tip={TIPS.aroas} value={pct(cur.newCustomerRoas)} delta={<Delta cur={cur.newCustomerRoas} prev={prev?.newCustomerRoas} />} sub={`손익분기 ${pct(bep)}`} />}
        <Kpi label="신규 고객 획득비용 (nCAC)" tip={TIPS.ncac} value={cur.newCustomerCac != null ? won(cur.newCustomerCac) : "—"}
          delta={<Delta cur={cur.newCustomerCac} prev={prev?.newCustomerCac} inverse ratio />} sub={`신규 ${NUM.format(meta.newN)}명`} />
        <Kpi label="픽셀 ROAS (메타 자체 집계)" tip={TIPS.pixel} value={pct(cur.pixelRoas)} delta={<Delta cur={cur.pixelRoas} prev={prev?.pixelRoas} />}
          sub={cur.pixelRoas != null && cur.metaRoas ? `귀속 대비 ×${(cur.pixelRoas / cur.metaRoas).toFixed(2)}` : ""} />
      </div>
    </section>
  );
}

// ── ② 구성 ────────────────────────────────────────────────────────────────

function Mix({ cur, prev, mode, colors, focus, setFocus }: {
  cur: ChannelPeriod; prev: ChannelPeriod | null; mode: Mode; colors: Record<ChannelGroup, string>;
  focus: ChannelGroup | null; setFocus: (g: ChannelGroup | null) => void;
}) {
  const total = cur.groups.reduce((s, g) => s + revOf(g, mode), 0);
  const ptotal = prev ? prev.groups.reduce((s, g) => s + revOf(g, mode), 0) : 0;
  const share = (g: ChannelGroupRow | undefined, t: number) => (g && t > 0 ? (revOf(g, mode) / t) * 100 : 0);
  const sumShare = (keys: ChannelGroup[]) => keys.reduce((s, k) => s + share(cur.groups.find((g) => g.group === k), total), 0);
  const toggle = (g: ChannelGroup) => setFocus(focus === g ? null : g);
  const splits: Array<[string, ChannelGroup[]]> = [["광고", ["meta"]], ["광고 외", ["search", "owned", "influencer", "referral"]], ["미귀속", ["unattributed"]]];

  return (
    <div className={CARD} aria-labelledby="ch-q2">
      <div className={EYEBROW} id="ch-q2">매출은 어디서 나오나요?</div>
      <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-zinc-100">채널별 매출 비중</h3>
      <div className="mt-3.5 flex h-11 gap-0.5 overflow-hidden rounded-lg" role="img" aria-label="채널별 매출 비중 막대">
        {ORDER.map((k) => {
          const g = cur.groups.find((x) => x.group === k)!;
          const sh = share(g, total);
          if (sh <= 0) return null;
          return (
            <button key={k} type="button" onClick={() => toggle(k)} title={`${LABEL[k]} ${man(revOf(g, mode))}원 · ${sh.toFixed(1)}%`}
              className="flex min-w-[3px] items-center overflow-hidden whitespace-nowrap pl-2.5 text-xs font-bold text-white transition-opacity"
              style={{ flex: sh, background: colors[k], opacity: focus && focus !== k ? 0.3 : 1 }}>
              {sh >= 9 ? `${LABEL[k]} ${sh.toFixed(0)}%` : ""}
            </button>
          );
        })}
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-1 sm:grid-cols-3">
        {ORDER.map((k) => {
          const g = cur.groups.find((x) => x.group === k)!;
          const sh = share(g, total);
          const d = prev ? sh - share(prev.groups.find((x) => x.group === k), ptotal) : null;
          return (
            <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={focus === k}
              className={`grid grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800 ${focus === k ? "bg-gray-100 dark:bg-zinc-800" : ""}`}>
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[k] }} />
              <span className="truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-200">{LABEL[k]}</span>
              <span className="col-start-2 text-xs tabular-nums text-gray-500 dark:text-zinc-400">
                {man(revOf(g, mode))} · {sh.toFixed(1)}%
                {d != null && <span className="ml-1 text-[11px] text-gray-400 dark:text-zinc-500">{Math.abs(d) < 0.05 ? "변화 없음" : `${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}%p`}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-gray-100 pt-3.5 dark:border-zinc-800">
        {splits.map(([name, keys]) => (
          <div key={name} className="text-xs text-gray-400 dark:text-zinc-500">{name}
            <b className="block text-lg font-extrabold tabular-nums text-gray-900 dark:text-zinc-100">{pct(sumShare(keys))}</b>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-gray-400 dark:text-zinc-500">
        광고 외 매출은 광고를 꺼도 나는 기본 매출이에요. 광고비를 늘릴 때 이 값도 같이 늘면 광고가 검색·입소문까지 키우고 있다는 신호예요.
      </p>
    </div>
  );
}

function DailyChart({ cur, prev, mode, colors, focus, theme }: {
  cur: ChannelPeriod; prev: ChannelPeriod | null; mode: Mode; colors: Record<ChannelGroup, string>; focus: ChannelGroup | null; theme: Theme;
}) {
  const [unit, setUnit] = useState<"amt" | "pct">("amt");
  const [hover, setHover] = useState<{ i: number; x: number; y: number; w: number } | null>(null);
  // 짧은 기간만 이전 기간 막대를 흐리게 함께 그린다 (길면 막대가 너무 가늘어짐).
  const prevDays = prev && cur.daily.length <= 14 ? prev.daily : [];
  const days: Array<ChannelDaily & { prev?: boolean }> = [...prevDays.map((d) => ({ ...d, prev: true })), ...cur.daily];
  const val = (d: ChannelDaily, g: ChannelGroup) => (mode === "new" ? d.newRev[g] : d.rev[g]);
  const tot = (d: ChannelDaily) => ORDER.reduce((s, g) => s + val(d, g), 0);
  const ink = theme === "dark"
    ? { grid: "#27272a", axis: "#71717a", strong: "#a1a1aa", line: "#3f3f46" }
    : { grid: "#f3f4f6", axis: "#9ca3af", strong: "#4b5563", line: "#e5e7eb" };

  const W = 560, H = 250, L = 46, R = 8, B = 30;
  const T = prevDays.length ? 24 : 10;
  const maxTot = Math.max(1, ...days.map(tot));
  const mag = Math.pow(10, Math.floor(Math.log10(maxTot)));
  const max = unit === "pct" ? 100 : Math.ceil(maxTot / mag) * mag;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const step = (W - L - R) / Math.max(days.length, 1);
  const bw = Math.min(46, step * 0.6);
  const labelEvery = Math.ceil(days.length / 10);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const split = L + step * prevDays.length;

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className={EYEBROW}>일별 추이</div><h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-zinc-100">일별 채널 매출</h3></div>
        <Seg value={unit} onChange={setUnit} label="단위" options={[["amt", "금액"], ["pct", "비중"]]} />
      </div>
      <div className="relative mt-2.5" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="일별 채널 매출 누적 막대">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={ink.grid} />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={ink.axis}>
                {unit === "pct" ? `${Math.round(t)}%` : `${NUM.format(Math.round(t / 1e4))}만`}
              </text>
            </g>
          ))}
          {prevDays.length > 0 && (
            <>
              <line x1={split} x2={split} y1={T - 14} y2={H - B} stroke={ink.line} strokeDasharray="3 3" />
              <text x={(L + split) / 2} y={T - 10} textAnchor="middle" fontSize={11} fill={ink.axis}>이전 기간</text>
              <text x={(split + W - R) / 2} y={T - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill={ink.strong}>선택 기간</text>
            </>
          )}
          {days.map((d, i) => {
            const x = L + step * i + (step - bw) / 2;
            const t = tot(d);
            const top = unit === "pct" ? (t > 0 ? 100 : 0) : t;
            let acc = 0;
            return (
              <g key={`${d.date}-${i}`}>
                <clipPath id={`ch-cp-${i}`}><rect x={x} y={y(top)} width={bw} height={Math.max(y(0) - y(top), 0)} rx={4} /></clipPath>
                <g clipPath={`url(#ch-cp-${i})`} opacity={d.prev ? 0.38 : 1}>
                  {ORDER.map((g) => {
                    const v = unit === "pct" ? (t > 0 ? (val(d, g) / t) * 100 : 0) : val(d, g);
                    if (v <= 0) return null;
                    const y1 = y(acc + v);
                    const h = y(acc) - y1;
                    acc += v;
                    return <rect key={g} x={x} y={y1} width={bw} height={Math.max(h - 2, 0.5)} fill={colors[g]} opacity={focus && focus !== g ? 0.25 : 1} />;
                  })}
                </g>
                <rect x={L + step * i} y={T} width={step} height={H - T - B} fill="transparent"
                  onMouseMove={(e) => {
                    const box = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                    if (box) setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width });
                  }} />
                {i % labelEvery === 0 && (
                  <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize={11} fill={d.prev ? ink.axis : ink.strong}>{fmtDay(d.date)}</text>
                )}
              </g>
            );
          })}
        </svg>
        {hover && days[hover.i] && (
          <DailyTooltip d={days[hover.i]} x={Math.min(hover.x + 14, hover.w - 196)} y={hover.y} total={tot(days[hover.i])} val={val} colors={colors} />
        )}
      </div>
      {prevDays.length > 0 && <p className="text-xs text-gray-400 dark:text-zinc-500">흐린 막대는 이전 기간(비교 기간)이에요.</p>}
    </div>
  );
}

function DailyTooltip({ d, x, y, total, val, colors }: {
  d: ChannelDaily & { prev?: boolean }; x: number; y: number; total: number;
  val: (d: ChannelDaily, g: ChannelGroup) => number; colors: Record<ChannelGroup, string>;
}) {
  return (
    <div className="pointer-events-none absolute z-20 min-w-[180px] rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left: Math.max(x, 0), top: Math.max(y - 150, 0) }}>
      <div className="mb-1.5 font-bold text-gray-900 dark:text-zinc-100">{fmtDay(d.date)}{d.prev ? " · 이전 기간" : ""} · {man(total)}원</div>
      {[...ORDER].reverse().filter((g) => val(d, g) > 0).map((g) => (
        <div key={g} className="grid grid-cols-[10px_1fr_auto] items-center gap-1.5 tabular-nums text-gray-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[g] }} />
          <span>{LABEL[g]}</span>
          <span>{man(val(d, g))} · {total > 0 ? ((val(d, g) / total) * 100).toFixed(0) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

// ── ③ 채널·캠페인 표 ───────────────────────────────────────────────────────

function ChannelTable({ cur, mode, colors, focus }: { cur: ChannelPeriod; mode: Mode; colors: Record<ChannelGroup, string>; focus: ChannelGroup | null }) {
  const [open, setOpen] = useState<Partial<Record<ChannelGroup, boolean>>>({ meta: true });
  const bep = cur.metaBreakEvenRoas;
  const total = cur.groups.reduce((s, g) => s + revOf(g, mode), 0);
  const maxRev = Math.max(1, ...cur.groups.map((g) => revOf(g, mode)));
  const shortName = useShortNames(cur.groups[0].children);
  const sharePct = (o: ChannelRow) => (total > 0 ? `${((revOf(o, mode) / total) * 100).toFixed(1)}%` : "—");
  const newPct = (o: ChannelRow) => (o.n > 0 ? `${((o.newN / o.n) * 100).toFixed(0)}%` : "—");
  const nameOf = (o: ChannelRow) => (o.campaignId ? shortName(o.name) : o.name);
  const muted = <span className="font-normal text-gray-400 dark:text-zinc-500">—</span>;
  const cp = (o: ChannelRow) => {
    if (mode === "new") return muted;
    const v = o.contributionProfit;
    return v < 0 ? <span className="text-rose-600 dark:text-rose-400">−{man(-v)}</span> : man(v);
  };
  const TD = "border-b border-gray-100 px-2.5 py-2.5 text-right tabular-nums dark:border-zinc-800";

  const row = (o: ChannelRow, g: ChannelGroup, kid: boolean) => {
    const r = roasOf(o, mode);
    const hasKids = !kid && (cur.groups.find((x) => x.group === g)?.children.length ?? 0) > 1;
    return (
      <tr key={`${g}-${o.key}`} className={`${kid ? "text-gray-600 dark:text-zinc-400" : "font-bold text-gray-900 dark:text-zinc-100"} ${focus === g ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}>
        <td className={`border-b border-gray-100 py-2.5 pr-2.5 dark:border-zinc-800 ${kid ? "pl-11" : ""}`}>
          <div className="flex items-center gap-2">
            {!kid && (hasKids ? (
              <button type="button" aria-expanded={Boolean(open[g])} aria-label={`${LABEL[g]} 펼치기`} onClick={() => setOpen({ ...open, [g]: !open[g] })}
                className="w-4 text-[11px] text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{open[g] ? "▼" : "▶"}</button>
            ) : <span className="w-4" />)}
            {!kid && <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[g] }} />}
            <span className="max-w-[220px] truncate" title={o.name}>{kid ? nameOf(o) : o.name}</span>
          </div>
        </td>
        <td className={TD}>
          <div className="grid grid-cols-[minmax(60px,140px)_52px] items-center justify-end gap-2.5">
            <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
              <div className="h-full rounded-full" style={{ width: `${(revOf(o, mode) / maxRev) * 100}%`, background: colors[g] }} />
            </div>
            <span>{man(revOf(o, mode))}</span>
          </div>
        </td>
        <td className={TD}>{sharePct(o)}</td>
        <td className={TD}>{NUM.format(cntOf(o, mode))}</td>
        <td className={TD}>{newPct(o)}</td>
        <td className={TD}>{o.spend > 0 ? man(o.spend) : muted}</td>
        <td className={TD}>{r == null ? muted : pct(r)}</td>
        <td className={TD}><StatusChip roas={r} bep={bep} /></td>
        <td className={`${TD} pr-0`}>{cp(o)}</td>
      </tr>
    );
  };

  return (
    <section className={CARD} aria-labelledby="ch-q3">
      <div className={EYEBROW} id="ch-q3">어느 캠페인을 키울까요?</div>
      <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-zinc-100">채널·캠페인별 성과</h3>

      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full whitespace-nowrap text-[13px]">
          <thead>
            <tr className="text-xs text-gray-400 dark:text-zinc-500">
              {["채널", "매출", "비중", "결제", "신규 비중", "광고비", "귀속 ROAS", "손익분기 대비", "공헌이익"].map((h, i) => (
                <th key={h} className={`border-b border-gray-200 px-2.5 py-2 font-medium dark:border-zinc-700 ${i === 0 ? "pl-0 text-left" : i === 8 ? "pr-0 text-right" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ORDER.flatMap((k) => {
              const g = cur.groups.find((x) => x.group === k)!;
              const out = [row(g, k, false)];
              if (open[k] && g.children.length > 1) g.children.forEach((c) => out.push(row(c, k, true)));
              return out;
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-2.5 md:hidden">
        {ORDER.map((k) => {
          const g = cur.groups.find((x) => x.group === k)!;
          const r = roasOf(g, mode);
          return (
            <div key={k} className={`grid gap-2 rounded-xl border border-gray-200 px-3.5 py-3 dark:border-zinc-800 ${focus === k ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}>
              <div className="flex items-center justify-between gap-2 font-bold text-gray-900 dark:text-zinc-100">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[k] }} />{LABEL[k]}</span>
                <StatusChip roas={r} bep={bep} />
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-xs text-gray-400 dark:text-zinc-500">
                <div>매출<b className="block text-sm tabular-nums text-gray-900 dark:text-zinc-100">{man(revOf(g, mode))}</b></div>
                <div>비중<b className="block text-sm tabular-nums text-gray-900 dark:text-zinc-100">{sharePct(g)}</b></div>
                <div>귀속 ROAS<b className="block text-sm tabular-nums text-gray-900 dark:text-zinc-100">{pct(r, 0)}</b></div>
              </div>
              {g.children.length > 1 && (
                <div className="grid gap-1.5 border-t border-gray-100 pt-2 text-xs dark:border-zinc-800">
                  {g.children.map((c) => (
                    <div key={c.key} className="flex justify-between gap-2 tabular-nums text-gray-600 dark:text-zinc-400">
                      <span className="truncate">{nameOf(c)}</span>
                      <span className="shrink-0">{man(revOf(c, mode))}{c.spend > 0 ? ` · ROAS ${pct(roasOf(c, mode), 0)}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-zinc-400">
        <span>귀속률 <b className="tabular-nums text-gray-900 dark:text-zinc-100">{pct(cur.coverage)}</b></span>
        <span className="h-2 w-28 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
          <span className="block h-full rounded-full bg-gray-500 dark:bg-zinc-400" style={{ width: `${cur.coverage ?? 0}%` }} />
        </span>
        <span className="tabular-nums">방문기록으로 복원 {NUM.format(cur.restoredCount)}건 · 미귀속 {NUM.format(cur.unattributedCount)}건</span>
        <Info text={TIPS.cov} label="귀속률" />
        <span className="text-gray-400 dark:text-zinc-500">손익분기 {pct(bep)} = 매출에서 VAT·PG 수수료·AI 원가를 빼고 남는 만큼만 광고비를 쓴 상태</span>
      </div>
    </section>
  );
}

// ── 섹션 ──────────────────────────────────────────────────────────────────

export default function ChannelSection({ data, loading, theme }: { data: ChannelsData | null; loading: boolean; theme: Theme }) {
  const [mode, setMode] = useState<Mode>("all");
  const [focus, setFocus] = useState<ChannelGroup | null>(null);
  const colors = COLORS[theme];
  const cur = data?.cur ?? null;
  const prev = data?.prev ?? null;
  const rangeText = cur ? `${fmtDay(cur.range.from)} – ${fmtDay(cur.range.until)}${prev ? " · 이전 기간 대비" : ""}` : "";

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-zinc-100">채널 성과</h2>
          {rangeText && <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs tabular-nums text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">{rangeText}</span>}
          {data?.clampedFrom && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">결제 유입 데이터가 있는 {fmtDay(data.clampedFrom)}부터 집계했어요</span>
          )}
          {cur && data?.attributionStale && data.attributionAsOf && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
              ⚠ Mixpanel 조회 한도로 {fmtClock(data.attributionAsOf)} 기준 유입 데이터예요
            </span>
          )}
          {cur && !data?.attributionStale && data?.attributionAsOf && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">유입 데이터 {fmtClock(data.attributionAsOf)} 기준 · 15분마다 갱신</span>
          )}
        </div>
        <Seg value={mode} onChange={setMode} label="고객 범위" options={[["all", "전체 고객"], ["new", "신규 고객만"]]} />
      </div>

      {!cur && loading && <div className={`${CARD} h-64 animate-pulse`} aria-label="채널 성과 불러오는 중" />}
      {!cur && !loading && (
        <div className={`${CARD} text-sm text-gray-500 dark:text-zinc-400`}>
          {data?.error || "채널 성과를 불러오지 못했어요. 새로고침을 눌러 다시 시도해 주세요."}
        </div>
      )}
      {cur && (
        <div className={`grid gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <Hero cur={cur} prev={prev} mode={mode} colors={colors} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Mix cur={cur} prev={prev} mode={mode} colors={colors} focus={focus} setFocus={setFocus} />
            <DailyChart cur={cur} prev={prev} mode={mode} colors={colors} focus={focus} theme={theme} />
          </div>
          <ChannelTable cur={cur} mode={mode} colors={colors} focus={focus} />
        </div>
      )}
    </div>
  );
}
