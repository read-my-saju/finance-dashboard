"use client";

/** 매출 출처: 결제가 마지막으로 들어온 경로별 비중 막대와 표. */
import { useMemo } from "react";
import type { ChannelGroup } from "@/lib/channel";
import { channelMix, fmtMan } from "@/lib/dashboard-view";
import { CARD, H2, SERIES, SUB, SectionHead, TXT, type ChannelsData } from "./ui";

const NAME: Record<ChannelGroup, [string, string]> = {
  meta: ["메타 광고", "마지막 클릭"],
  search: ["검색", "네이버, 구글"],
  unattributed: ["미귀속", ""],
  owned: ["자사 SNS", "인스타 프로필, 카카오"],
  referral: ["레퍼럴", "블로그 등"],
  influencer: ["인플루언서", "할인 링크"],
  search_ad: ["검색광고", "네이버 파워링크"],
};
const pct = (n: number) => `${n.toFixed(1)}%`;
const LINE = "border-[#E3E8EE] dark:border-[#232836]";

function Swatch({ zero, color, className }: { zero: boolean; color: string; className: string }) {
  return (
    <span className={`block shrink-0 rounded-[3px] ${className} ${zero ? "bg-[#C9CED8] dark:bg-[#3A4150]" : ""}`} style={zero ? undefined : { background: color }} />
  );
}

export default function RevenueSources({ data, loading, theme }: { data: ChannelsData | null; loading: boolean; theme: "light" | "dark" }) {
  const cur = data?.cur ?? null;
  const mix = useMemo(() => (cur ? channelMix(cur.groups) : null), [cur]);

  if (!cur || !mix) {
    return (
      <section className="mt-6" aria-labelledby="revenue-sources">
        <SectionHead title="매출 출처" />
        {loading
          ? <div className={`${CARD} h-64 animate-pulse`} aria-label="매출 출처 불러오는 중" />
          : <div className={`${CARD} text-sm ${TXT.sub}`}>{data?.error || "매출 출처를 불러오지 못했습니다. 새로고침을 눌러 다시 시도해 주세요."}</div>}
      </section>
    );
  }

  const colors = SERIES[theme];
  const segs = mix.rows.filter((r) => r.amount > 0);
  const aria = mix.rows.map((r) => `${NAME[r.key][0]} ${pct(r.share)}`).join(", ");

  return (
    <section className="mt-6" aria-labelledby="revenue-sources">
      <div className={`${CARD} flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        <div>
          <h2 id="revenue-sources" className={`${H2} ${TXT.main}`}>매출 출처</h2>
          <p className={`${SUB} ${TXT.sub}`}>결제 {cur.payments.toLocaleString("ko-KR")}건이 마지막으로 들어온 경로</p>
        </div>

        <div className="flex flex-col gap-2">
          <span className={`text-xs font-semibold ${TXT.main}`}>
            메타 광고 영향 {fmtMan(mix.influence.amount)} ({Math.round(mix.influence.share)}%)
          </span>
          <div aria-hidden="true" className="h-1.5 rounded-t border border-b-0 border-[#9AA3B2] dark:border-[#5B6475]" style={{ width: `${mix.influence.share}%` }} />
          <div role="img" aria-label={aria} className="flex h-9 gap-0.5 overflow-hidden rounded-lg">
            {segs.map((r) => (
              <div
                key={r.key}
                className="flex items-center overflow-hidden whitespace-nowrap pl-2 text-xs font-semibold text-white"
                style={{ width: `${r.share}%`, background: colors[r.key] }}
              >
                {r.key === "meta" && r.share > 20 ? `메타 ${Math.round(r.share)}%` : ""}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          {mix.rows.map((r) => {
            const zero = r.amount === 0;
            const [name, desc] = NAME[r.key];
            return (
              <div key={r.key} className={`border-b last:border-b-0 ${LINE} ${zero ? TXT.dim : TXT.main}`}>
                {/* 휴대폰: 2칸 목록. 왼쪽 색 표식과 이름, 아래 설명. 오른쪽 금액, 아래 비중과 건수 */}
                <div className="flex min-h-14 items-start justify-between gap-3 py-3 md:hidden">
                  <div className="flex min-w-0 items-start gap-3">
                    <Swatch zero={zero} color={colors[r.key]} className="mt-1 h-3 w-3" />
                    <div className="min-w-0">
                      <div className="break-keep text-sm">{name}</div>
                      {desc && <div className={`text-xs ${TXT.dim}`}>{desc}</div>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums">{zero ? "0원" : fmtMan(r.amount)}</div>
                    <div className={`text-xs tabular-nums ${zero ? "" : TXT.sub}`}>{pct(r.share)}, {r.n}건</div>
                  </div>
                </div>
                <div className="hidden grid-cols-[14px_minmax(0,1fr)_64px_48px_44px] items-center gap-3 py-2 text-[13px] md:grid">
                  <Swatch zero={zero} color={colors[r.key]} className="h-2.5 w-2.5" />
                  <span className="min-w-0 break-keep">{name} {desc && <small className={`text-xs ${TXT.dim}`}>{desc}</small>}</span>
                  <span className="text-right font-semibold tabular-nums">{zero ? "0원" : fmtMan(r.amount)}</span>
                  <span className={`text-right tabular-nums ${zero ? "" : TXT.sub}`}>{pct(r.share)}</span>
                  <span className={`text-right tabular-nums ${TXT.dim}`}>{r.n}건</span>
                </div>
              </div>
            );
          })}
        </div>

        <p className={`text-xs ${TXT.dim}`}>검색과 미귀속은 메타 광고비를 따라 움직여서 메타 ROAS에 들어가 있습니다(9/4~11/12 상관 0.97).</p>
      </div>
    </section>
  );
}
