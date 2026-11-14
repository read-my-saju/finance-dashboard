"use client";

/** 최근 30일 추이: 위는 결제매출과 광고비 선, 아래는 공헌이익 막대. 두 차트가 같은 날을 가리키는 하나의 툴팁. */
import { useState } from "react";
import { fmtMan } from "@/lib/dashboard-view";
import { CARD, SERIES, SectionHead, TXT } from "./ui";

export type TrendRow = { date: string; netRevenue: number; adSpend: number; contributionProfit: number };

const H_TOP = 200;
const H_BAR = 90;
const GAP = 12; // 두 차트 사이 간격(px)
const GRID = "border-[#EEF1F5] dark:border-[#1C2130]";
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// 1, 2, 5 x 10^k 중 max를 4칸 안에 담는 눈금 간격
function niceStep(max: number): number {
  const raw = Math.max(max, 1) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
}

// 끝 라벨끼리 겹치지 않게 벌린다 (px, 위에서부터)
function spread(a: number, b: number, gap = 16): [number, number] {
  if (Math.abs(a - b) >= gap) return [a, b];
  const mid = (a + b) / 2;
  return a <= b ? [mid - gap / 2, mid + gap / 2] : [mid + gap / 2, mid - gap / 2];
}

export default function Trend30({ rows, theme }: { rows: TrendRow[]; theme: "light" | "dark" }) {
  const [hover, setHover] = useState<number | null>(null);
  const c = SERIES[theme];
  const n = rows.length;
  if (n === 0) return null;

  const top = Math.max(30000, ...rows.map((r) => Math.max(r.netRevenue, r.adSpend)));
  const step = niceStep(top);
  const ticks = Array.from({ length: Math.ceil(top / step) + 1 }, (_, k) => k);
  const yMax = step * (ticks.length - 1);
  const px = (v: number) => H_TOP - (Math.max(v, 0) / yMax) * H_TOP;
  const xPct = (i: number) => ((i + 0.5) / n) * 100;
  const line = (get: (r: TrendRow) => number) =>
    rows.map((r, i) => `${i ? "L" : "M"}${xPct(i)} ${(px(get(r)) / H_TOP) * 100}`).join(" ");

  const pMax = Math.max(0, ...rows.map((r) => r.contributionProfit));
  const pMin = Math.min(0, ...rows.map((r) => r.contributionProfit));
  const pSpan = pMax - pMin || 1;
  const zeroY = (pMax / pSpan) * 100;
  const last = rows[n - 1];
  const [revLy, adLy] = spread(px(last.netRevenue), px(last.adSpend));
  const tickIdx = rows.map((_, i) => i).filter((i) => (n - 1 - i) % 5 === 0);
  const hr = hover === null ? null : rows[hover];
  const mer = hr && hr.adSpend > 0 ? `${Math.round((hr.netRevenue / hr.adSpend) * 100)}%` : "—";
  const flip = hover !== null && hover > n / 2;
  const plotH = H_TOP + GAP + H_BAR;

  const leg = (color: string, label: string, box = false) => (
    <span className="inline-flex items-center gap-2">
      <span className={box ? "h-2.5 w-2.5 rounded-sm" : "h-0.5 w-4 rounded-full"} style={{ background: color }} />
      {label}
    </span>
  );

  return (
    <section className="mt-6" aria-label="최근 30일 추이">
      <div className={CARD}>
        <SectionHead
          title="최근 30일 추이"
          sub={`${md(rows[0].date)} – ${md(last.date)}, 어제까지`}
          right={
            <div className={`flex flex-wrap gap-4 text-xs ${TXT.sub}`}>
              {leg(c.revenue, "결제매출")}{leg(c.ad, "광고비")}{leg(c.profit, "공헌이익", true)}
            </div>
          }
        />
        <div className="flex gap-2" aria-hidden="true">
          {/* 왼쪽 눈금 */}
          <div aria-hidden="true" className={`relative w-12 flex-none text-xs ${TXT.dim}`}>
            {ticks.map((k) => (
              <span key={k} className="absolute right-0" style={{ top: px(k * step) - 7 }}>{k ? fmtMan(k * step) : "0"}</span>
            ))}
            {pMax > 0 && <span className="absolute right-0" style={{ top: H_TOP + GAP - 7 }}>{fmtMan(pMax)}</span>}
            <span className="absolute right-0" style={{ top: H_TOP + GAP + (zeroY / 100) * H_BAR - 7 }}>0</span>
            {pMin < 0 && <span className="absolute right-0" style={{ top: H_TOP + GAP + H_BAR - 7 }}>{fmtMan(pMin)}</span>}
          </div>

          {/* 차트 */}
          <div className="relative min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
            <div className="relative" style={{ height: H_TOP }}>
              {ticks.map((k) => (
                <div key={k} className={`absolute inset-x-0 border-t ${GRID}`} style={{ top: Math.min(px(k * step), H_TOP - 1) }} />
              ))}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                <path d={line((r) => r.netRevenue)} fill="none" stroke={c.revenue} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                <path d={line((r) => r.adSpend)} fill="none" stroke={c.ad} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              {hr && [[hr.netRevenue, c.revenue], [hr.adSpend, c.ad]].map(([v, col]) => (
                <span
                  key={col as string}
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-[#12151C]"
                  style={{ left: `${xPct(hover!)}%`, top: px(v as number), background: col as string }}
                />
              ))}
            </div>

            <div className="relative" style={{ height: H_BAR, marginTop: GAP }}>
              <div className="absolute inset-x-0 border-t border-[#E3E8EE] dark:border-[#2A3040]" style={{ top: `${zeroY}%` }} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                {rows.map((r, i) => {
                  const h = (Math.abs(r.contributionProfit) / pSpan) * 100;
                  const y = r.contributionProfit >= 0 ? zeroY - h : zeroY;
                  return (
                    <rect key={r.date} x={xPct(i) - 30 / n} width={60 / n} y={y} height={h} fill={c.profit}
                      opacity={hover === null || hover === i ? 1 : 0.55} />
                  );
                })}
              </svg>
            </div>

            <div className={`relative mt-1 h-5 text-xs ${TXT.dim}`} aria-hidden="true">
              {tickIdx.map((i) => (
                <span key={i} className={`absolute -translate-x-1/2 whitespace-nowrap ${(n - 1 - i) % 10 === 0 ? "" : "hidden md:block"}`} style={{ left: `${xPct(i)}%` }}>{md(rows[i].date)}</span>
              ))}
            </div>

            {/* 호버 영역, 세로선, 툴팁: 두 차트 전체를 덮음 */}
            <div className="absolute inset-x-0 top-0 flex" style={{ height: plotH }}>
              {rows.map((r, i) => (
                <div key={r.date} className="h-full flex-1" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              ))}
            </div>
            {hr && (
              <>
                <div className="pointer-events-none absolute top-0 w-px bg-[#9AA3B2] dark:bg-[#5B6475]" style={{ left: `${xPct(hover!)}%`, height: plotH }} />
                <div
                  className="pointer-events-none absolute top-2 z-10 flex min-w-[150px] flex-col gap-1 rounded-xl border border-[#E3E8EE] bg-white p-2.5 text-xs shadow-lg dark:border-[#2A3040] dark:bg-[#1B202C]"
                  style={flip ? { right: `${100 - xPct(hover!) + 1}%` } : { left: `${xPct(hover!) + 1}%` }}
                >
                  <span className={`font-bold ${TXT.main}`}>{md(hr.date)}</span>
                  {([["결제매출", fmtMan(hr.netRevenue)], ["광고비", fmtMan(hr.adSpend)], ["공헌이익", fmtMan(hr.contributionProfit)], ["MER", mer]] as const).map(([k, v]) => (
                    <span key={k} className={`flex justify-between gap-3 ${TXT.sub}`}><span>{k}</span><b className={TXT.main}>{v}</b></span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 오른쪽 끝 마지막 값 */}
          <div aria-hidden="true" className="relative w-20 flex-none text-xs font-semibold">
            <span className={`absolute left-0 flex items-center gap-1 whitespace-nowrap ${TXT.main}`} style={{ top: revLy - 8 }}>
              <i className="h-0.5 w-2 flex-none rounded-full" style={{ background: c.revenue }} />{fmtMan(last.netRevenue)}
            </span>
            <span className={`absolute left-0 flex items-center gap-1 whitespace-nowrap ${TXT.main}`} style={{ top: adLy - 8 }}>
              <i className="h-0.5 w-2 flex-none rounded-full" style={{ background: c.ad }} />{fmtMan(last.adSpend)}
            </span>
          </div>
        </div>
        <table className="sr-only">
          <caption>최근 30일 일별 결제매출, 광고비, 공헌이익</caption>
          <thead><tr><th>날짜</th><th>결제매출</th><th>광고비</th><th>공헌이익</th><th>MER</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{md(r.date)}</td><td>{fmtMan(r.netRevenue)}</td><td>{fmtMan(r.adSpend)}</td><td>{fmtMan(r.contributionProfit)}</td>
                <td>{r.adSpend > 0 ? `${Math.round((r.netRevenue / r.adSpend) * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Trend30Placeholder({ loading }: { loading: boolean }) {
  return (
    <section className="mt-6" aria-label="최근 30일 추이">
      <div className={CARD}>
        <SectionHead title="최근 30일 추이" />
        {loading
          ? <div role="status" className="h-72 animate-pulse rounded-xl bg-[#EEF1F5] dark:bg-[#1C2130]" aria-label="추이 불러오는 중" />
          : <p className={`text-sm ${TXT.dim}`}>추이를 불러오지 못했습니다</p>}
      </div>
    </section>
  );
}
