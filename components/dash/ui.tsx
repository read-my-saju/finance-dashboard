import type { ReactNode } from "react";
import type { Verdict } from "@/lib/dashboard-view";

export const CARD =
  "rounded-2xl border border-[#E3E8EE] bg-white p-5 dark:border-[#232836] dark:bg-[#12151C]";

export const TXT = {
  main: "text-[#0D1B2A] dark:text-[#ECEEF2]",
  sub: "text-[#4B5565] dark:text-[#A3AAB8]",
  dim: "text-[#6B7280] dark:text-[#8A92A3]",
};

export function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className={`text-lg font-extrabold tracking-tight ${TXT.main}`}>{title}</h2>
        {sub && <p className={`mt-0.5 text-sm ${TXT.sub}`}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

type Tone = Verdict | "live" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  good: "border-[#15803d]/30 text-[#15803d] dark:border-[#3fb950]/30 dark:text-[#3fb950]",
  warn: "border-[#b45309]/30 text-[#b45309] dark:border-[#fab219]/30 dark:text-[#fab219]",
  bad: "border-[#dc2626]/30 text-[#dc2626] dark:border-[#f07070]/30 dark:text-[#f07070]",
  live: "border-[#E3E8EE] text-[#4B5565] dark:border-[#232836] dark:text-[#A3AAB8]",
  muted: "border-[#E3E8EE] text-[#6B7280] dark:border-[#232836] dark:text-[#8A92A3]",
};

const ICON: Record<Tone, ReactNode> = {
  good: <path d="M3 8.5l3.5 3.5L13 4.5" />,
  warn: <path d="M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.2v.1" />,
  bad: <path d="M4 4l8 8M12 4l-8 8" />,
  live: <path d="M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2 1.3" />,
  muted: null,
};

export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {ICON[tone] && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {ICON[tone]}
        </svg>
      )}
      {children}
    </span>
  );
}

export type SeriesKey =
  | "revenue" | "ad" | "profit" | "meta" | "search" | "unattributed"
  | "owned" | "referral" | "influencer" | "search_ad" | "costs";

export const SERIES: { light: Record<SeriesKey, string>; dark: Record<SeriesKey, string> } = {
  light: {
    revenue: "#2a78d6", ad: "#eb6834", profit: "#1baf7a", meta: "#2a78d6", search: "#eb6834",
    unattributed: "#b9b7b1", owned: "#1baf7a", referral: "#6250d6",
    influencer: "#eda100", search_ad: "#4a3aa7", costs: "#9AA3B2",
  },
  dark: {
    revenue: "#3987e5", ad: "#d95926", profit: "#199e70", meta: "#3987e5", search: "#d95926",
    unattributed: "#55554F", owned: "#199e70", referral: "#9085e9",
    influencer: "#c98500", search_ad: "#9085e9", costs: "#6B7385",
  },
};
