import { fmtMan, profitBreakdown, profitHeadline, type BreakdownInput } from "@/lib/dashboard-view";
import { CARD, SERIES, SectionHead, TXT } from "./ui";

type Ad = { seeding: number; branding: number };

const BAD = "text-[#dc2626] dark:text-[#f07070]";
const won = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}원`;

export default function ProfitBreakdown({ totals, totalsWithMarketing, adBreakdown, includeMarketing, live, theme }: {
  totals?: BreakdownInput; totalsWithMarketing?: BreakdownInput; adBreakdown?: Ad;
  includeMarketing: boolean; live: boolean; theme: "light" | "dark";
}) {
  if (!totals) return null;
  const { rows, segs, profitPer100 } = profitBreakdown(totals);
  const palette = SERIES[theme];
  const aria = `결제 100원 중 ${segs.map((s) => `${s.label} ${won(s.per100)}`).join(", ")}`;

  let note: string | null = null;
  if (includeMarketing) {
    if (adBreakdown) note = `광고비에 시딩 ${fmtMan(adBreakdown.seeding)}, 브랜딩 ${fmtMan(adBreakdown.branding)}이 들어 있습니다.`;
  } else if (totalsWithMarketing) {
    note = `시딩과 브랜딩 비용(${fmtMan(totalsWithMarketing.adSpend - totals.adSpend)})은 빠져 있습니다. 켜면 공헌이익 ${fmtMan(totalsWithMarketing.contributionProfit)}.`;
  }

  return (
    <section aria-labelledby="s-wf" className={`${CARD} mt-4 min-w-0`}>
      <SectionHead title="매출에서 이익까지" />
      <p id="s-wf" className={`text-xl font-bold tracking-tight ${profitPer100 < 0 ? BAD : TXT.main}`}>
        {totals.netRevenue === 0 ? `아직 결제가 없습니다${live ? " (진행 중)" : ""}` : profitHeadline(profitPer100, live)}
      </p>

      <div role="img" aria-label={aria} className="mt-4 flex h-7 gap-0.5 overflow-hidden rounded-lg">
        {segs.map((s) => (
          <div key={s.key} className={s.per100 > 0 ? "min-w-[3px]" : ""} style={{ width: `${s.per100}%`, background: palette[s.key] }} />
        ))}
      </div>
      <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm ${TXT.sub}`}>
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: palette[s.key] }} />
            {s.label} <b className={`font-bold ${TXT.main}`}>{won(s.per100)}</b>
          </span>
        ))}
      </div>

      <div className="mt-4 text-sm">
        <div className={`grid grid-cols-[20px_minmax(0,1fr)_84px_64px] gap-2 border-b border-[#E3E8EE] px-2 pb-2 text-xs dark:border-[#232836] sm:grid-cols-[20px_minmax(0,1fr)_104px_80px] ${TXT.dim}`}>
          <span>기호</span><span>계산</span><span className="text-right">금액</span><span className="text-right">100원당</span>
        </div>
        {rows.map((r) => {
          const strong = r.kind !== "minus";
          const loss = r.kind === "final" && r.amount < 0;
          const numCls = loss ? BAD : strong ? TXT.main : TXT.sub;
          return (
            <div
              key={r.label}
              className={`grid grid-cols-[20px_minmax(0,1fr)_84px_64px] items-center gap-2 rounded-lg px-2 py-2 sm:grid-cols-[20px_minmax(0,1fr)_104px_80px] ${strong ? "font-bold" : ""} ${r.kind === "eq" ? "border-t border-[#C9D1DC] dark:border-[#2A3040]" : ""} ${r.kind === "final" && !loss ? "bg-[#15803d]/10 dark:bg-[#199e70]/15" : ""}`}
            >
              <span className={`text-center ${TXT.dim}`}>{r.sign}</span>
              <span className={strong ? TXT.main : TXT.sub}>{r.label}</span>
              <span className={`whitespace-nowrap text-right tabular-nums ${numCls}`}>{r.sign === "−" ? "−" : ""}{fmtMan(r.amount)}</span>
              <span className={`whitespace-nowrap text-right tabular-nums ${loss ? BAD : strong ? TXT.main : TXT.dim}`}>{won(r.per100)}</span>
            </div>
          );
        })}
      </div>
      {note && <p className={`mt-3 text-xs ${TXT.dim}`}>{note}</p>}
    </section>
  );
}
