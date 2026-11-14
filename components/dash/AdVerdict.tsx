"use client";

/** 광고 판정: 메타 ROAS(광고관리자 기준)와 손익분기를 비교하고 캠페인별로 증액/유지/감액을 보여준다. */
import { useMemo } from "react";
import {
  fmtMan, mergeCampaignOps, verdictOf, type CampaignOps, type CampaignView, type Verdict,
} from "@/lib/dashboard-view";
import { CARD, H2, SERIES, SUB, SectionHead, StatusChip, TXT, type ChannelsData } from "./ui";

type CampaignsLike = { campaigns: CampaignOps[]; metaError?: string | null } | null;

const pct = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(d)}%`);
const day = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString();
const clockWithDay = (iso: string) => {
  const k = kst(iso);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return `${k.slice(0, 10) === today ? "" : day(k.slice(0, 10)) + " "}${k.slice(11, 16)}`;
};
const money = (v: number) => fmtMan(Math.round(v));
const scale = (v: number) => (Math.min(Math.max(v, 0), 200) / 200) * 100;
const gap = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%p`;

const HERO_COPY: Record<Verdict, string> = { good: "높음, 증액 가능", warn: "높음, 유지", bad: "낮음, 감액 검토" };
const ROW_COPY: Record<Verdict, string> = { good: "증액 가능", warn: "유지", bad: "감액 검토" };
const COLS = "grid grid-cols-[1.3fr_0.8fr_2fr_1.15fr_0.8fr_0.8fr_0.6fr_0.75fr_0.65fr] gap-3";
const LINE = "border-[#E3E8EE] dark:border-[#232836]";
const TRACK = "bg-[#EEF1F5] dark:bg-[#1F2430]";
const MARK = "bg-[#0D1B2A] dark:bg-[#ECEEF2]";

export default function AdVerdict({ data, campaigns, loading, live, asOf, theme }: {
  data: ChannelsData | null; campaigns: CampaignsLike; loading: boolean; live: boolean; asOf: string | null; theme: "light" | "dark";
}) {
  const cur = data?.cur ?? null;
  const prev = live ? null : data?.prev ?? null;
  const bep = cur?.metaBreakEvenRoas ?? 0;
  const rows = useMemo<CampaignView[]>(
    () => (cur ? mergeCampaignOps(cur.groups[0].children, campaigns?.campaigns ?? [], bep) : []),
    [cur, campaigns, bep],
  );
  const color = SERIES[theme].meta;

  const head = (
    <>
      {data?.clampedFrom && <span className={`text-xs ${TXT.dim}`}>결제 유입 데이터가 있는 {day(data.clampedFrom)}부터 집계했습니다</span>}
      {cur && data?.attributionStale && data.attributionAsOf && (
        <StatusChip tone="warn">Mixpanel 조회 한도로 {clockWithDay(data.attributionAsOf)} 기준 유입 데이터입니다</StatusChip>
      )}
    </>
  );

  if (!cur) {
    return (
      <section className="mt-6" aria-labelledby="ad-verdict">
        <SectionHead title="광고 판정" />
        {loading
          ? <div className={`${CARD} h-64 animate-pulse`} aria-label="광고 판정 불러오는 중" />
          : <div className={`${CARD} text-sm ${TXT.sub}`}>{data?.error || "광고 판정을 불러오지 못했습니다. 새로고침을 눌러 다시 시도해 주세요."}</div>}
      </section>
    );
  }

  const meta = cur.groups[0];
  const roas = meta.spend > 0 ? cur.pixelRoas : null;
  const v = live ? null : verdictOf(roas, bep);
  const d = roas != null ? roas - bep : null;
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const revOf = (g: string) => cur.groups.find((x) => x.group === g)?.rev ?? 0;
  const realRev = meta.rev + revOf("search") + revOf("unattributed");
  const pixelRev = cur.pixelRoas != null ? (cur.pixelRoas / 100) * meta.spend : null;
  const check = pixelRev ? (realRev / pixelRev) * 100 : null;
  const days = Math.round((Date.parse(cur.range.until) - Date.parse(cur.range.from)) / 86400000) + 1;
  const checkChip = check != null && days >= 7
    ? <StatusChip tone={check >= 90 && check <= 110 ? "good" : "bad"}>실제 돈 확인 {pct(check, 0)}</StatusChip>
    : <StatusChip tone="muted">실제 돈 확인은 7일 이상 볼 때</StatusChip>;
  const prevDiff = roas != null && prev?.pixelRoas != null ? roas - prev.pixelRoas : null;

  return (
    <section className="mt-6" aria-labelledby="ad-verdict">
      <div className={`${CARD} transition-opacity ${loading ? "opacity-60" : ""}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="ad-verdict" className={`${H2} ${TXT.main}`}>광고 판정</h2>
            <p className={`${SUB} ${TXT.sub}`}>메타 ROAS(광고관리자 기준)와 손익분기를 비교합니다</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{head}{checkChip}</div>
        </div>

        <div className="flex flex-wrap gap-6">
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-4">
            <div>
              <span className={`text-[13px] md:text-sm ${TXT.sub}`}>메타 ROAS</span>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className={`text-[40px] font-bold leading-none tracking-tight tabular-nums sm:text-[56px] ${TXT.main}`}>{pct(roas)}</span>
                {live ? (
                  <span className={`text-xs ${TXT.dim}`}>{asOf ? `${clockWithDay(asOf)} 기준, ` : ""}하루 동안 계속 바뀝니다</span>
                ) : prevDiff != null && prev?.pixelRoas != null && Math.abs(prevDiff) >= 0.05 ? (
                  <>
                    <span className={`text-[13px] font-semibold tabular-nums ${prevDiff > 0 ? "text-[#15803d] dark:text-[#3fb950]" : "text-[#dc2626] dark:text-[#f07070]"}`}>
                      {prevDiff > 0 ? "▲" : "▼"} {Math.abs(prevDiff).toFixed(1)}%p
                    </span>
                    <span className={`text-xs ${TXT.dim}`}>이전 {pct(prev.pixelRoas)}</span>
                  </>
                ) : null}
              </div>
            </div>

            {roas != null && (
              <div className="relative pt-[22px]" role="img" aria-label={`손익분기 ${pct(bep)} 대비 메타 ROAS ${pct(roas)}`}>
                <span className={`absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums ${TXT.main}`} style={{ left: `${scale(bep)}%` }}>
                  손익분기 {pct(bep)}
                </span>
                <div className={`relative h-3 rounded-full ${TRACK}`}>
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${scale(roas)}%`, background: color }} />
                  <div className={`absolute -bottom-[5px] -top-[5px] w-0.5 rounded-sm ${MARK}`} style={{ left: `calc(${scale(bep)}% - 1px)` }} />
                </div>
                <div className={`mt-2 flex justify-between text-xs tabular-nums ${TXT.dim}`}><span>0%</span><span>100%</span><span>200%</span></div>
              </div>
            )}

            {live ? (
              <div className="self-start"><StatusChip tone="live">진행 중인 날이라 판정하지 않습니다</StatusChip></div>
            ) : v && d != null && (
              <div className="self-start">
                <StatusChip tone={v}>손익분기보다 {Math.abs(d).toFixed(1)}%p {HERO_COPY[v]}</StatusChip>
              </div>
            )}

            <div className={`grid grid-cols-3 gap-2 border-t pt-4 ${LINE}`}>
              <Fact label="광고비" value={money(meta.spend)} />
              <Fact label="공헌이익" value={money(totalProfit)} />
              <Fact label="마지막 클릭" value={pct(cur.metaRoas)} dim />
            </div>
          </div>

          <div className="min-w-0 flex-[999_1_560px]">
            <ul className="flex flex-col gap-2 md:hidden" aria-label="캠페인별 판정">
              {rows.length === 0 && <li className={`py-6 text-center text-sm ${TXT.dim}`}>광고비를 쓴 캠페인이 없습니다.</li>}
              {rows.map((c) => (
                <li key={c.campaignId} className={`rounded-xl border p-4 text-sm ${LINE} ${TXT.main}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="break-words break-keep font-semibold">{c.name}</span>
                      <span className={`text-xs ${TXT.dim}`}>마지막 클릭 결제 {c.lastClickN}건</span>
                    </div>
                    <div className="shrink-0"><VerdictCell c={c} live={live} bep={bep} /></div>
                  </div>
                  <div className="mt-3"><RoasBar c={c} bep={bep} color={color} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <Fact label="광고비" value={money(c.spend)} />
                    <Fact label="공헌이익" value={money(c.profit)} tone={c.profit < 0 && !live ? "loss" : undefined} />
                  </div>
                  <p className={`mt-3 text-xs ${TXT.dim}`}>
                    마지막 클릭 {pct(c.lastClickRoas)}, CTR {c.ctr == null ? "—" : pct(c.ctr, 2)}, CPM {c.cpm == null ? "—" : `₩${Math.round(c.cpm).toLocaleString("ko-KR")}`}, 일 예산 {c.dailyBudget ? fmtMan(c.dailyBudget) : "—"}
                  </p>
                </li>
              ))}
              <li className={`rounded-xl border p-4 text-sm font-bold ${LINE}`}>
                <div className={`flex items-baseline justify-between ${TXT.main}`}>
                  <span>메타 전체</span>
                  <span className="tabular-nums">{pct(roas)}</span>
                </div>
                <div className={`mt-1 flex justify-between text-xs font-semibold tabular-nums ${TXT.sub}`}>
                  <span>광고비 {money(meta.spend)}</span><span>공헌이익 {money(totalProfit)}</span>
                </div>
              </li>
            </ul>
            <p className={`mx-1 mt-2 text-xs md:hidden ${TXT.dim}`}>공헌이익은 광고비 × (메타 ROAS ÷ 손익분기 − 1)입니다.</p>
            <div className="hidden overflow-x-auto md:block">
            <div className="min-w-[860px]">
              <div className={`${COLS} border-b px-1 pb-2.5 text-xs ${LINE} ${TXT.dim}`}>
                <span>캠페인</span><span className="text-right">광고비</span><span>메타 ROAS</span><span>판정</span>
                <span className="text-right">공헌이익</span><span className="text-right">마지막 클릭</span>
                <span className="text-right">CTR</span><span className="text-right">CPM</span><span className="text-right">일 예산</span>
              </div>
              {rows.length === 0 && <p className={`py-6 text-center text-sm ${TXT.dim}`}>광고비를 쓴 캠페인이 없습니다.</p>}
              {rows.map((c) => {
                return (
                  <div key={c.campaignId} className={`${COLS} items-center border-b px-1 py-3 text-[13px] ${LINE} ${TXT.main}`}>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words break-keep font-semibold" title={c.name}>{c.name}</span>
                      <span className={`text-xs ${TXT.dim}`}>마지막 클릭 결제 {c.lastClickN}건</span>
                    </div>
                    <span className="text-right tabular-nums">{money(c.spend)}</span>
                    <RoasBar c={c} bep={bep} color={color} />
                    <div><VerdictCell c={c} live={live} bep={bep} /></div>
                    <span className={`text-right font-semibold tabular-nums ${c.profit < 0 && !live ? "text-[#dc2626] dark:text-[#f07070]" : ""}`}>{money(c.profit)}</span>
                    <span className={`text-right tabular-nums ${TXT.sub}`}>{pct(c.lastClickRoas)}</span>
                    <span className={`text-right tabular-nums ${TXT.sub}`}>{c.ctr == null ? "—" : pct(c.ctr, 2)}</span>
                    <span className={`text-right tabular-nums ${TXT.sub}`}>{c.cpm == null ? "—" : `₩${Math.round(c.cpm).toLocaleString("ko-KR")}`}</span>
                    <span className={`text-right tabular-nums ${TXT.sub}`}>{c.dailyBudget ? fmtMan(c.dailyBudget) : "—"}</span>
                  </div>
                );
              })}
              <div className={`${COLS} items-center px-1 py-3 text-[13px] font-bold ${TXT.main}`}>
                <span>메타 전체</span>
                <span className="text-right tabular-nums">{money(meta.spend)}</span>
                <span className="tabular-nums">{pct(roas)}</span>
                <span />
                <span className="text-right tabular-nums">{money(totalProfit)}</span>
                <span className={`text-right font-semibold tabular-nums ${TXT.sub}`}>{pct(cur.metaRoas)}</span>
                <span /><span /><span />
              </div>
              <p className={`mx-1 mt-1.5 whitespace-normal text-xs ${TXT.dim}`}>
                공헌이익은 광고비 × (메타 ROAS ÷ 손익분기 − 1)입니다. 마지막 클릭은 광고를 마지막으로 클릭하고 산 실제 결제 기준이라 참고로만 봅니다.
              </p>
            </div>
            </div>
            {campaigns?.metaError && <p className="mx-1 mt-1 text-xs text-[#b45309] dark:text-[#fab219]">{campaigns.metaError}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function RoasBar({ c, bep, color }: { c: CampaignView; bep: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`relative h-2 flex-1 rounded-full ${TRACK}`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${scale(c.metaRoas ?? 0)}%`, background: color }} />
        <div className={`absolute -bottom-1 -top-1 w-0.5 ${MARK}`} style={{ left: `calc(${scale(bep)}% - 1px)` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-semibold tabular-nums">{pct(c.metaRoas)}</span>
    </div>
  );
}

function VerdictCell({ c, live, bep }: { c: CampaignView; live: boolean; bep: number }) {
  if (live) return <StatusChip tone="live">진행 중</StatusChip>;
  const cd = c.metaRoas != null ? c.metaRoas - bep : null;
  return c.verdict && cd != null
    ? <StatusChip tone={c.verdict}>{gap(cd)} {ROW_COPY[c.verdict]}</StatusChip>
    : <span className={TXT.dim}>—</span>;
}

function Fact({ label, value, dim, tone }: { label: string; value: string; dim?: boolean; tone?: "loss" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={`text-xs ${TXT.dim}`}>{label}</span>
      <span className={`text-base font-semibold tabular-nums ${tone === "loss" ? "text-[#dc2626] dark:text-[#f07070]" : dim ? TXT.sub : TXT.main}`}>{value}</span>
    </div>
  );
}
