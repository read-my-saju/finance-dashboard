"use client";

/**
 * 세트 판매 카드 — 채널 성과 아래 접는 카드 안에 들어간다 (2026-10-23 시안 확정).
 * 위 '채널·캠페인별 성과' 표에 있는 결제 수·귀속 ROAS 는 다시 싣지 않고 세트 몫만 보여 준다.
 * 숫자는 /api/dashboard/channels 의 cur.sets (lib/channel-revenue.ts buildSetSales). 여기선 비율·표시만.
 */
import { breakAtUnderscore, commonCampaignWords, shortCampaignName } from "@/lib/campaign-name";
import type { SetSales as SetSalesData } from "@/lib/channel-revenue";
import { fmtDay, man, NUM } from "./ChannelSection";

type Theme = "light" | "dark";

// 채널 성과와 같은 범주색 계열 (라이트·다크 각각). 단품은 미귀속과 같은 회색.
const SET_COLORS: Record<Theme, Record<string, string>> = {
  light: { "인생+신년운세 세트": "#2a78d6", "인생+연애운 세트": "#e87ba4", "연애+궁합운 세트": "#eda100", "인생+수능운 세트": "#1baf7a", "궁합+신년운세 세트": "#4a3aa7", 단품: "#b9b7b1" },
  dark: { "인생+신년운세 세트": "#3987e5", "인생+연애운 세트": "#d55181", "연애+궁합운 세트": "#c98500", "인생+수능운 세트": "#199e70", "궁합+신년운세 세트": "#9085e9", 단품: "#55554f" },
};
const colorOf = (theme: Theme, name: string) => SET_COLORS[theme][name] ?? SET_COLORS[theme].단품;
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${n.toFixed(d)}%`);

const TH = "border-b border-gray-200 px-2.5 py-2 text-right font-medium dark:border-zinc-700";
// 이름 칸이 남는 폭을 먹어서 숫자 칸이 오른쪽에 모인다.
const TH_NAME = "w-full border-b border-gray-200 py-2 pr-2.5 text-left font-medium dark:border-zinc-700";
const TD = "border-b border-gray-100 px-2.5 py-2.5 text-right tabular-nums dark:border-zinc-800";
const MUTED = "text-gray-400 dark:text-zinc-500";

function Tile({ label, value, sub, detail }: { label: string; value: string; sub: React.ReactNode; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-gray-200 px-3 py-3 dark:border-zinc-800 sm:px-4 sm:py-3.5">
      <div className="text-xs font-semibold text-gray-500 dark:text-zinc-400">{label}</div>
      <div className="whitespace-nowrap text-base font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-zinc-100 sm:text-[26px]">{value}</div>
      <div className="text-xs tabular-nums text-gray-400 dark:text-zinc-500">{sub}{detail && <span className="hidden sm:inline"> {detail}</span>}</div>
    </div>
  );
}

function Bar({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
      <div className="h-full rounded-full" style={{ width: `${Math.min(value ?? 0, 100)}%`, background: color }} />
    </div>
  );
}

function BySetTable({ sets, theme }: { sets: SetSalesData; theme: Theme }) {
  const days = sets.daily.length || 1;
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">세트별</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full whitespace-nowrap text-[13px]">
          <thead>
            <tr className="text-xs text-gray-400 dark:text-zinc-500">
              <th className={TH_NAME}>세트</th><th className={TH}>매출</th><th className={TH}>세트 중</th><th className={TH}>결제</th><th className={`${TH} hidden pr-0 sm:table-cell`}>하루 평균</th>
            </tr>
          </thead>
          <tbody>
            {sets.bySet.map((s) => (
              <tr key={s.name} className="text-gray-700 dark:text-zinc-300">
                <td className="border-b border-gray-100 py-2.5 pr-2.5 dark:border-zinc-800">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(theme, s.name) }} />{s.name}</span>
                </td>
                <td className={`${TD} font-bold text-gray-900 dark:text-zinc-100`}>{man(s.rev)}</td>
                <td className={TD}>{pct(share(s.rev, sets.rev))}</td>
                <td className={TD}>{NUM.format(s.n)}</td>
                <td className={`${TD} hidden pr-0 sm:table-cell ${MUTED}`}>{(s.n / days).toFixed(1)}건</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DailyMix({ sets, theme }: { sets: SetSalesData; theme: Theme }) {
  const names = sets.bySet.map((s) => s.name);
  const ink = theme === "dark" ? { grid: "#27272a", axis: "#71717a", strong: "#d4d4d8" } : { grid: "#f3f4f6", axis: "#9ca3af", strong: "#374151" };
  // 좁은 폭(모바일 카드 ~320px)에서도 축 글자가 읽히게 viewBox 를 작게 잡는다.
  const W = 440, H = 210, L = 36, R = 6, T = 22, B = 28;
  const tot = (d: SetSalesData["daily"][number]) => d.singleN + names.reduce((s, n) => s + (d.n[n] || 0), 0);
  const maxTot = Math.max(1, ...sets.daily.map(tot));
  const stepTick = Math.max(1, Math.ceil(maxTot / 4 / 10) * 10);
  const max = stepTick * 4;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const step = (W - L - R) / Math.max(sets.daily.length, 1);
  const bw = Math.min(40, step * 0.6);
  const labelEvery = Math.ceil(sets.daily.length / 10);
  const showShare = sets.daily.length <= 14;

  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
        일별 결제 구성 <span className="text-xs font-normal text-gray-400 dark:text-zinc-500">{showShare ? "막대 위 = 그날 매출 중 세트 비중" : "막대 = 결제 건수"}</span>
      </h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mt-2" role="img" aria-label="일별 결제 건수를 세트 종류와 단품으로 나눈 누적 막대">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(i * stepTick)} y2={y(i * stepTick)} stroke={ink.grid} />
            <text x={L - 8} y={y(i * stepTick) + 4} textAnchor="end" fontSize={11} fill={ink.axis}>{i * stepTick}</text>
          </g>
        ))}
        {sets.daily.map((d, i) => {
          const x = L + step * i + (step - bw) / 2;
          let acc = 0;
          const parts = [...names.map((n) => [n, d.n[n] || 0] as const), ["단품", d.singleN] as const];
          const s = share(d.rev, d.totalRev);
          return (
            <g key={d.date}>
              <title>{`${fmtDay(d.date)} · 결제 ${tot(d)}건 · 세트 ${tot(d) - d.singleN}건 · 매출 중 세트 ${pct(s, 0)}`}</title>
              {parts.map(([name, v]) => {
                if (v <= 0) return null;
                const y1 = y(acc + v);
                const h = y(acc) - y1;
                acc += v;
                return <rect key={name} x={x} y={y1} width={bw} height={Math.max(h - 1, 0.5)} fill={colorOf(theme, name)} />;
              })}
              {showShare && s != null && (
                <text x={x + bw / 2} y={y(acc) - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={ink.strong}>{s.toFixed(0)}%</text>
              )}
              {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={ink.axis}>{fmtDay(d.date)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-zinc-400">
        {[...names, "단품"].map((n) => (
          <span key={n} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(theme, n) }} />{n === "단품" ? "단품·질문권" : n.replace(" 세트", "")}</span>
        ))}
      </div>
    </section>
  );
}

function ByCampaignTable({ sets, theme }: { sets: SetSalesData; theme: Theme }) {
  const rows = sets.byCampaign.filter((c) => c.totalRev > 0 || c.spend > 0);
  const common = commonCampaignWords(rows.filter((r) => r.campaignId).map((r) => r.name));
  const barColor = colorOf(theme, "인생+신년운세 세트");
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
        캠페인별 세트 <span className="text-xs font-normal text-gray-400 dark:text-zinc-500">결제·귀속 ROAS 전체는 위 채널·캠페인별 성과 표</span>
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full whitespace-nowrap text-[13px]">
          <thead>
            <tr className="text-xs text-gray-400 dark:text-zinc-500">
              <th className={TH_NAME}>캠페인</th><th className={`${TH} hidden sm:table-cell`}>세트 결제</th><th className={TH}>세트 매출</th><th className={TH}>매출 중 세트</th><th className={`${TH} pr-0`}><span className="sm:hidden">ROAS 중 세트</span><span className="hidden sm:inline">귀속 ROAS 중 세트 몫</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = share(c.rev, c.totalRev);
              return (
                <tr key={c.key} className="text-gray-700 dark:text-zinc-300">
                  <td className="max-w-[220px] whitespace-normal break-keep border-b border-gray-100 py-2.5 pr-2.5 dark:border-zinc-800" title={c.name}>
                    {c.campaignId ? breakAtUnderscore(shortCampaignName(c.name, common)) : <span className={MUTED}>{c.name}</span>}
                  </td>
                  <td className={`${TD} hidden sm:table-cell`}>{NUM.format(c.n)}</td>
                  <td className={`${TD} font-bold text-gray-900 dark:text-zinc-100`}>{c.n > 0 ? man(c.rev) : <span className={MUTED}>—</span>}</td>
                  <td className={TD}>
                    <div className="flex items-center justify-end gap-2.5">
                      <div className="hidden w-24 sm:block"><Bar value={s} color={c.campaignId ? barColor : colorOf(theme, "단품")} /></div>
                      <span className="w-10">{pct(s, 0)}</span>
                    </div>
                  </td>
                  <td className={`${TD} pr-0`}>{c.spend > 0 ? `${((c.rev / c.spend) * 100).toFixed(0)}%p` : <span className={MUTED}>광고비 없음</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SetSales({ sets, theme }: { sets: SetSalesData; theme: Theme }) {
  const totalRev = sets.rev + sets.singleRev;
  const totalN = sets.n + sets.singleN;
  const setAov = sets.n > 0 ? sets.rev / sets.n : null;
  const singleAov = sets.singleN > 0 ? sets.singleRev / sets.singleN : null;

  if (sets.n === 0) {
    return <p className="text-sm text-gray-500 dark:text-zinc-400">이 기간에는 세트 결제가 없어요. 세트는 10/10부터 판매했어요.</p>;
  }
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="세트 매출" value={man(sets.rev)} sub={`매출의 ${pct(share(sets.rev, totalRev), 0)}`} detail={`(전체 ${man(totalRev)} 중)`} />
        <Tile label="세트 결제" value={`${NUM.format(sets.n)}건`} sub={`결제의 ${pct(share(sets.n, totalN), 0)}`} detail={`(전체 ${NUM.format(totalN)}건 중)`} />
        <Tile
          label="세트 객단가"
          value={setAov == null ? "—" : `${NUM.format(Math.round(setAov))}원`}
          sub={setAov != null && singleAov ? <>단품보다 <b className="text-emerald-600 dark:text-emerald-400">+{(((setAov - singleAov) / singleAov) * 100).toFixed(0)}%</b></> : "—"}
          detail={singleAov ? `(단품 ${NUM.format(Math.round(singleAov))}원)` : undefined}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <BySetTable sets={sets} theme={theme} />
        <DailyMix sets={sets} theme={theme} />
      </div>
      <ByCampaignTable sets={sets} theme={theme} />
      <p className="text-xs leading-relaxed text-gray-400 dark:text-zinc-500">
        귀속 ROAS와 픽셀 ROAS는 세트 결제 금액을 이미 전액 포함해요. 이 카드는 그중 세트가 얼마인지 나눠 보여 줘요.
        세트는 &lsquo;결제창 상품 + 결제 금액&rsquo;으로 구분해서, 할인 코드가 붙거나 가격이 바뀐 세트는 단품으로 잡힐 수 있어요.
      </p>
    </div>
  );
}
