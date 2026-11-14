# 재무 대시보드 화면 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 11/14 시안대로 재무 대시보드를 한 화면 다섯 질문 구조(손익, 광고 판정, 매출에서 이익까지, 매출 출처, 30일 추이)로 바꾸고 운영에 반영한다.

**Architecture:** 숫자 계산은 서버 API 그대로 쓰고, 화면용 가공(기간 프리셋, 어제 같은 시각 합, 100원 분해, 판정, 캠페인 표 병합, 채널 묶음)은 순수 함수 `lib/dashboard-view.ts`에 모아 node:assert 테스트로 고정한다. 화면은 `components/dash/` 아래 섹션별 파일로 나누고 `Dashboard.tsx`는 데이터 불러오기와 배치만 맡는다.

**Tech Stack:** Next.js 15.5, React 19, Tailwind(darkMode class), recharts 2.15, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-14-finance-dashboard-redesign-design.md` (시안 원본 `scratchpad\fdesign\project\Main.dc.html`)

## Global Constraints

- 서버 API(`app/api/**`, `lib/profit.ts`, `lib/channel-revenue.ts`의 계산)는 바꾸지 않는다. 같은 기간과 스위치에서 화면 숫자 = API 숫자, 0원 차이.
- 판정: 메타 ROAS(`pixelRoas`) − 손익분기 ≥ 5%p 좋음, 0~5%p 주의, < 0 나쁨. 상태 색은 아이콘과 글자를 같이.
- 오늘 보기(from = until = KST 오늘): 판정 칩, 실제 돈 확인 숫자, 캠페인 판정 칩을 보이지 않는다.
- 7일, 30일 프리셋은 어제까지. 기본 기간은 PR A에서 7일, PR B에서 오늘.
- 화면 문구에 가운뎃점(·)을 새로 쓰지 않는다. 금액은 만 원 단위, 10만 미만은 소수 한 자리.
- 색은 설계 문서 '스타일' 표 값 그대로. 라이트와 다크 둘 다. 버튼 높이 40px 이상. 390px에서 가로 넘침 0.
- 테스트 실행 명령(저장소 규칙): `npx tsc lib/<name>.test.ts --outDir .test-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node && node .test-out/<name>.test.js`
- 작업 폴더는 `C:\Users\justi\dev\fd-redesign`(OneDrive 밖). OneDrive의 standalone 폴더는 다른 세션의 미커밋 작업이 있어 건드리지 않는다.

## Review Focus

- 오늘 0시대(어제 시간대 자료가 비었거나 지금이 0시 몇 분): 어제 같은 시각 비교가 0이나 NaN 대신 "—"로 나온다. → Task 1 `sameTimeRevenue` 빈 배열 테스트, Task 4 표시 규칙.
- 공헌이익 음수(광고비 > 남는 돈): 큰 문장이 "결제 100원당 N원 손실입니다", 남는 돈 막대 0, 마지막 줄 빨강. → Task 1 손실 테스트.
- 광고비는 있는데 구매가 0건인 캠페인(pixelRoas 0 또는 null)과 meta-campaigns 오류(ops 없음): 표가 깨지지 않고 ROAS "—"나 0%, CTR과 CPM "—". → Task 7 테스트.
- 메타 광고비 0원 기간(1~3월, 채널 자료가 9/3부터라 잘린 기간): 히어로 "—", 0으로 나누지 않음, 잘린 기간 안내 유지. → Task 7 `verdictOf(null)`, Task 8 표시.
- 시딩과 브랜딩 스위치 켜짐: 손익 카드, 100원 분해, 30일 추이가 모두 `WithMarketing` 쪽을 쓴다. → Task 4, 5, 11 운영 확인 항목.

---

## PR A — 뼈대, 손익 카드, 매출에서 이익까지 (브랜치 `feat/dashboard-redesign`)

### Task 1: 화면 가공 함수 (`lib/dashboard-view.ts`)

**Files:**
- Create: `lib/dashboard-view.ts`
- Test: `lib/dashboard-view.test.ts`

**Interfaces:**
- Produces:
  - `type PresetKey = "today" | "yesterday" | "week" | "month30" | "thisMonth" | "lastMonth" | "all"`
  - `presetRange(key: PresetKey, today: string): { from: string; until: string }`
  - `presetOf(from: string, until: string, today: string): PresetKey | null`
  - `sameTimeRevenue(hourly: Array<{ hour: number; amount: number }>, hour: number, minute: number): number`
  - `fmtMan(won: number): string`
  - `type BreakdownInput = { netRevenue: number; vat: number; revenueExVat: number; pgFee: number; reportCost: number; adSpend: number; contributionProfit: number }`
  - `type BreakdownRow = { sign: "" | "−" | "="; label: string; amount: number; per100: number; kind: "start" | "minus" | "eq" | "final" }`
  - `type BreakdownSeg = { key: "costs" | "ad" | "profit"; label: string; amount: number; per100: number }`
  - `profitBreakdown(t: BreakdownInput): { rows: BreakdownRow[]; segs: BreakdownSeg[]; profitPer100: number }`
  - `profitHeadline(profitPer100: number, live: boolean): string`
  - `type Verdict = "good" | "warn" | "bad"`; `verdictOf(roas: number | null, breakEven: number): Verdict | null`

- [ ] **Step 1: 실패하는 테스트 작성** (`lib/dashboard-view.test.ts`, 기존 테스트처럼 node:assert, 끝에 `console.log("dashboard-view.test OK")`)

```ts
assert.deepEqual(presetRange("week", "2026-11-14"), { from: "2026-11-07", until: "2026-11-13" });
assert.deepEqual(presetRange("month30", "2026-11-14"), { from: "2026-10-15", until: "2026-11-13" });
assert.deepEqual(presetRange("thisMonth", "2026-11-14"), { from: "2026-11-01", until: "2026-11-14" });
assert.deepEqual(presetRange("lastMonth", "2026-11-14"), { from: "2026-10-01", until: "2026-10-31" });
assert.deepEqual(presetRange("lastMonth", "2026-01-05"), { from: "2025-12-01", until: "2025-12-31" });
assert.deepEqual(presetRange("yesterday", "2026-11-14"), { from: "2026-11-13", until: "2026-11-13" });
assert.deepEqual(presetRange("all", "2026-11-14"), { from: "2026-01-01", until: "2026-11-14" });
assert.equal(presetOf("2026-11-07", "2026-11-13", "2026-11-14"), "week");
assert.equal(presetOf("2026-11-03", "2026-11-09", "2026-11-14"), null);
// 11/13 시간대별: 0시 247,400, 1시 139,600 → 01:33까지 = 247,400 + 139,600 × 33/60
assert.equal(Math.round(sameTimeRevenue([{ hour: 0, amount: 247400 }, { hour: 1, amount: 139600 }, { hour: 2, amount: 89800 }], 1, 33)), 324180);
assert.equal(sameTimeRevenue([], 1, 33), 0);
assert.equal(fmtMan(39455700), "3,946만");
assert.equal(fmtMan(93845), "9.4만");
assert.equal(fmtMan(-280000), "−28만");
assert.equal(fmtMan(0), "0원");
const wk = { netRevenue: 39455700, vat: 3586882, revenueExVat: 35868818, pgFee: 1360206, reportCost: 550500, adSpend: 26661153, contributionProfit: 7296960 };
const b = profitBreakdown(wk);
assert.deepEqual(b.rows.map((r) => r.sign + r.label), ["결제매출", "−부가세", "=부가세 제외 매출", "−결제수수료", "−리포트 원가", "−광고비", "=공헌이익 (남는 돈)"]);
assert.equal(b.profitPer100.toFixed(1), "18.5");
assert.deepEqual(b.segs.map((s) => s.per100.toFixed(1)), ["13.9", "67.6", "18.5"]);
assert.equal(profitHeadline(b.profitPer100, false), "결제 100원 중 18.5원이 남습니다");
assert.equal(profitHeadline(46.3, true), "결제 100원 중 46.3원이 남습니다 (진행 중)");
const loss = profitBreakdown({ netRevenue: 1000000, vat: 90909, revenueExVat: 909091, pgFee: 32000, reportCost: 5000, adSpend: 1200000, contributionProfit: -327909 });
assert.equal(loss.segs[2].amount, 0);
assert.equal(profitHeadline(loss.profitPer100, false), "결제 100원당 32.8원 손실입니다");
assert.ok(profitBreakdown({ ...wk, netRevenue: 0 }).rows.every((r) => Number.isFinite(r.per100)));
assert.equal(verdictOf(138.6, 116.2), "good");
assert.equal(verdictOf(120, 116.2), "warn");
assert.equal(verdictOf(110, 116.2), "bad");
assert.equal(verdictOf(null, 116.2), null);
```

- [ ] **Step 2: 실행해 실패 확인** — 저장소 테스트 명령(`dashboard-view`). Expected: 컴파일 오류(모듈 없음).
- [ ] **Step 3: `lib/dashboard-view.ts` 구현** — 날짜 계산은 `YYYY-MM-DD` 문자열을 UTC Date로 다뤄 시간대 영향을 없앤다(`Dashboard.tsx` `addDays`와 같은 방식). `fmtMan`: |값| ≥ 100,000이면 반올림 정수 + 천 단위 쉼표, 아니면 소수 한 자리(".0"은 지움), 0은 "0원", 음수는 "−". `profitBreakdown` 의 segs 는 costs = 부가세 + 결제수수료 + 리포트 원가, ad, profit = max(공헌이익, 0); netRevenue 0이면 per100 은 0.
- [ ] **Step 4: 통과 확인** — 같은 명령. Expected: `dashboard-view.test OK`
- [ ] **Step 5: Commit** — `git add lib/dashboard-view.ts lib/dashboard-view.test.ts && git commit -m "feat: 대시보드 화면 가공 함수(기간 프리셋, 어제 같은 시각, 100원 분해, 판정)"`

### Task 2: 색, 글꼴, 공용 부품 (`components/dash/ui.tsx`)

**Files:**
- Modify: `app/layout.tsx` (Pretendard CSS `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`), `app/globals.css`(body 바탕과 글자색: 라이트 #F6F8FB/#0D1B2A, 다크 #0B0D12/#ECEEF2, `font-variant-numeric: tabular-nums`)
- Create: `components/dash/ui.tsx`

**Interfaces:**
- Produces: `CARD`(카드 class 문자열, 라이트 흰 바탕 #E3E8EE 테두리, 다크 #12151C 바탕 #232836 테두리, rounded-2xl, p-5), `TXT`(`{ main, sub, dim }` class 문자열), `SectionHead({ title, sub?, right? })`, `StatusChip({ tone: Verdict | "live" | "muted", children })`(아이콘 체크, 삼각형, X, 시계; 설계 문서 상태 색), `SERIES`(`{ light: Record<SeriesKey,string>, dark: Record<SeriesKey,string> }`, SeriesKey = "revenue" | "ad" | "profit" | "meta" | "search" | "unattributed" | "owned" | "referral" | "influencer" | "search_ad" | "costs").

- [ ] **Step 1:** 위 파일 작성. 시리즈 색 값은 설계 문서 표 그대로, influencer와 search_ad 는 Task 9에서 검사기로 확정하므로 우선 지금 `ChannelSection` 값.
- [ ] **Step 2:** `npx tsc --noEmit -p .` Expected: 오류 0.
- [ ] **Step 3: Commit** — `feat: 새 색과 Pretendard 로딩, 대시보드 공용 부품`

### Task 3: 머리줄과 기간 버튼

**Files:**
- Modify: `components/Dashboard.tsx` (`Header`, `FilterBar`, 기본 기간 state 초기값)

**Interfaces:**
- Consumes: `presetRange`, `presetOf`, `PresetKey`(Task 1)

- [ ] **Step 1:** `FilterBar`를 기간 버튼 7개(오늘, 어제, 7일, 30일, 이번 달, 지난 달, 전체)로 바꾸고 `presetOf`로 고른 버튼에 `aria-pressed`와 선택 스타일. 날짜 입력 2개는 버튼 줄 오른쪽에 작게 유지. 시딩과 브랜딩 스위치는 머리줄로 옮긴다(지금 광고비 카드 안 `MarketingSwitch` 재사용). 새로고침, 테마, 로그아웃 유지.
- [ ] **Step 2:** 기본 state 를 `presetRange("week", todayStr())`로(어제까지 7일). 머리줄 설명 한 줄: 완료 기간이면 "M/D (요일) – M/D (요일), 완료된 N일. 화살표는 이전 N일 대비", 오늘이면 "M/D (요일) HH:MM 기준, 진행 중. 비교는 어제 같은 시각".
- [ ] **Step 3:** `npx tsc --noEmit -p .` 오류 0.
- [ ] **Step 4: Commit** — `feat: 기간 버튼 7개(7일과 30일은 어제까지)와 머리줄 정리`

### Task 4: 손익 카드 6장 (`components/dash/KpiCards.tsx`)

**Files:**
- Create: `components/dash/KpiCards.tsx`
- Modify: `components/Dashboard.tsx` (`KpiStrip`, `KpiCard`, `RoasKpiCard`, `ProfitKpiCard`, `DeltaBadge`, 스파크라인 제거 후 새 컴포넌트 사용, 오늘이면 어제 `/api/payments?from=어제&until=어제` 추가 호출)

**Interfaces:**
- Consumes: `fmtMan`, `sameTimeRevenue`(Task 1), `CARD`, `TXT`(Task 2), 기존 `ProfitTotals`, `PrevTotals`, `AdBreakdown`
- Produces: `KpiCards(props: { totals?: ProfitTotals; prev: PrevTotals | null; adBreakdown?: AdBreakdown; live: boolean; yesterdaySameTime: number | null; prevDays: number })`

- [ ] **Step 1:** 카드 순서와 보조 줄은 설계 문서 2번 그대로. 비교 줄: 완료 기간은 지금 `delta()` 일평균 로직을 옮겨 쓰고 "이전 N일 대비"를 붙인다(N = prevDays). 매출, MER, 공헌이익은 오르면 초록 내리면 빨강, 비용 3장은 회색. 오늘은 결제매출만 `yesterdaySameTime`과 비교("어제 이 시각 X", 0이거나 null이면 "—"), 나머지는 "진행 중", MER은 "진행 중이라 판정 안 함".
- [ ] **Step 2:** `Dashboard.tsx`에서 오늘일 때만 어제 payments 를 불러 `sameTimeRevenue(hourly, KST 시, 분)`을 넘긴다.
- [ ] **Step 3:** `npx tsc --noEmit -p .`와 `npm run build` 통과.
- [ ] **Step 4: Commit** — `feat: 손익 카드 6장(부가세 제외 매출, 오늘은 어제 같은 시각 비교)`

### Task 5: 매출에서 이익까지와 빠지는 구역 삭제

**Files:**
- Create: `components/dash/ProfitBreakdown.tsx`
- Modify: `components/Dashboard.tsx` (2~3번 구역, 2.5 월별 구역, 시간대별, 결제수단 TOP5 삭제와 관련 함수 삭제)

**Interfaces:**
- Consumes: `profitBreakdown`, `profitHeadline`, `fmtMan`(Task 1), `SectionHead`, `CARD`, `SERIES`(Task 2)
- Produces: `ProfitBreakdown(props: { totals?: ProfitTotals; totalsWithMarketing?: ProfitTotals; includeMarketing: boolean; live: boolean; theme: "light" | "dark" })`

- [ ] **Step 1:** 설계 문서 4번 그대로: 큰 문장, 100원 막대(세그먼트 사이 2px, 최소 3px), 범례 "N.N원", 계산서 표(기호, 계산, 금액, 100원당), 아래 시딩과 브랜딩 안내 한 줄(꺼짐이면 `totalsWithMarketing`과의 차이와 켰을 때 공헌이익, 켜짐이면 "광고비에 시딩 X, 브랜딩 Y가 들어 있습니다").
- [ ] **Step 2:** 삭제: `PeriodSummaryCard`, `InsightPanel`, `RoasChart`, `CostStructureBar`, `HourlyChart`, `ChannelTopList`, `MonthlyTrendChart`, `MonthlyContributionChart`, `DailyProfitChart`과 이것들만 쓰던 헬퍼, 타입, state. `DailyTable` 접힘 카드와 `ChannelSection`, `SetSales`, Meta 캠페인 운영 지표 접힘은 이번 PR에서 그대로.
- [ ] **Step 3:** `npx tsc --noEmit -p .`, 테스트 4개(channel, calc, toss, dashboard-view), `npm run build` 통과.
- [ ] **Step 4: Commit** — `feat: 매출에서 이익까지(결제 100원 분해)와 쓰지 않는 구역 삭제`

### Task 6: PR A 내보내기

- [ ] **Step 1:** `typescript-reviewer` 에이전트로 `git diff origin/main...HEAD` 리뷰, CRITICAL과 HIGH 수정.
- [ ] **Step 2:** `git push -u origin feat/dashboard-redesign`, `gh pr create --base main` (본문: 설계 문서 링크, PR A 범위, 검증 체크리스트).
- [ ] **Step 3:** Vercel 체크 통과 후 `gh pr merge --merge`, 운영 배포 상태 success 대기.
- [ ] **Step 4: 운영 확인** — 크롬 로그인 탭에서 7일, 오늘, 30일, 전체: 카드 숫자 = `/api/dashboard/summary` totals(스위치 꺼짐과 켜짐), 100원 분해 합 100.0±0.1, 오늘 비교 줄 동작, 라이트와 다크, 390px(같은 출처 iframe 폭 390으로 `scrollWidth` 확인).

## PR B — 광고 판정, 매출 출처, 기본 오늘 (새 브랜치 `feat/dashboard-redesign-b`, origin/main 기준)

### Task 7: 캠페인 표와 채널 묶음 가공 함수

**Files:**
- Modify: `lib/dashboard-view.ts`, `lib/dashboard-view.test.ts`

**Interfaces:**
- Consumes: `ChannelRow`, `ChannelGroupRow`(`lib/channel-revenue.ts`), `contributionProfitAtRoas`(`lib/calc.ts`)
- Produces:
  - `type CampaignOps = { campaignId: string; ctr: number | null; cpm: number | null; dailyBudget: number | null }`
  - `type CampaignView = { campaignId: string; name: string; spend: number; metaRoas: number | null; lastClickRoas: number | null; lastClickN: number; profit: number; verdict: Verdict | null; ctr: number | null; cpm: number | null; dailyBudget: number | null }`
  - `mergeCampaignOps(children: ChannelRow[], ops: CampaignOps[], breakEven: number): CampaignView[]` — 광고비 > 0 만, 광고비 큰 순.
  - `type MixRow = { key: ChannelGroup; amount: number; n: number; share: number }`
  - `channelMix(groups: ChannelGroupRow[]): { rows: MixRow[]; influence: { amount: number; share: number } }` — rows 순서 meta, search, unattributed, owned, referral, influencer, search_ad. influence = meta + search + unattributed.

- [ ] **Step 1: 테스트 추가**

```ts
const kids = [
  { key: "a", name: "26_3Q_성공운_sales_rebranding_판매", campaignId: "a", rev: 300, n: 3, newRev: 0, newN: 0, spend: 100, roas: 300, pixelRoas: 150, breakEvenRoas: 116, contributionProfit: 0 },
  { key: "x", name: "캠페인 불명", rev: 50, n: 1, newRev: 0, newN: 0, spend: 0, roas: null, pixelRoas: null, breakEvenRoas: 116, contributionProfit: 10 },
  { key: "b", name: "26_3Q_취업운_sales_rebranding_판매", campaignId: "b", rev: 0, n: 0, newRev: 0, newN: 0, spend: 300, roas: 0, pixelRoas: null, breakEvenRoas: 116, contributionProfit: -300 },
];
const v = mergeCampaignOps(kids as any, [{ campaignId: "a", ctr: 2.42, cpm: 34257, dailyBudget: 1831868 }], 116);
assert.deepEqual(v.map((c) => c.campaignId), ["b", "a"]);
assert.equal(v[0].ctr, null);
assert.equal(v[0].verdict, null);
assert.equal(v[1].profit, contributionProfitAtRoas(100, 150, 116));
assert.equal(v[1].verdict, "good");
const mix = channelMix([
  { group: "meta", rev: 33660600, n: 928 }, { group: "search", rev: 1693300, n: 51 }, { group: "owned", rev: 2155200, n: 62 },
  { group: "referral", rev: 568400, n: 16 }, { group: "unattributed", rev: 1378200, n: 44 }, { group: "influencer", rev: 0, n: 0 }, { group: "search_ad", rev: 0, n: 0 },
] as any);
assert.deepEqual(mix.rows.map((r) => r.key), ["meta", "search", "unattributed", "owned", "referral", "influencer", "search_ad"]);
assert.equal(mix.influence.share.toFixed(1), "93.1");
assert.equal(channelMix([]).influence.share, 0);
```

- [ ] **Step 2:** 실행해 실패 확인. **Step 3:** 구현(이름은 `shortCampaignName`과 `commonCampaignWords` 재사용, pixelRoas null 이면 metaRoas null, profit 은 광고비 × (0 ÷ 손익분기 − 1) = −광고비, verdict 는 `verdictOf`). **Step 4:** 통과 확인. **Step 5: Commit** — `feat: 캠페인 표 병합과 채널 묶음 가공 함수`

### Task 8: 광고 판정 (`components/dash/AdVerdict.tsx`)

**Files:**
- Create: `components/dash/AdVerdict.tsx`
- Modify: `components/Dashboard.tsx` (`ChannelSection` 대신 배치, Meta 캠페인 운영 지표 접힘과 `CampaignTable` 삭제)

**Interfaces:**
- Consumes: `mergeCampaignOps`, `verdictOf`, `fmtMan`(Task 1, 7), `StatusChip`, `SectionHead`, `CARD`(Task 2), `ChannelsData`, `CampaignsData`
- Produces: `AdVerdict(props: { data: ChannelsData | null; campaigns: CampaignsData | null; loading: boolean; live: boolean; asOf: string | null; theme: "light" | "dark" })`

- [ ] **Step 1:** 설계 문서 3번 그대로. 실제 돈 확인 계산은 `ChannelSection` Hero의 식(마지막 클릭 + 검색 + 미귀속 ÷ 픽셀 매출)을 옮긴다. 7일 미만이면 회색 칩. 오늘이면 판정 칩 대신 회색 "진행 중인 날이라 판정하지 않습니다", 표 판정 칸 "진행 중", 큰 숫자 옆 "HH:MM 기준". 메타 광고비 0이면 큰 숫자 "—"와 판정 없음. 잘린 기간(`clampedFrom`)과 Mixpanel 지연(`attributionStale`) 안내는 카드 머리에 유지.
- [ ] **Step 2:** `npx tsc --noEmit -p .` 오류 0. **Step 3: Commit** — `feat: 광고 판정(메타 ROAS 히어로와 캠페인 표, 운영 지표 흡수)`

### Task 9: 매출 출처, 채널 색, 기본 오늘

**Files:**
- Create: `components/dash/RevenueSources.tsx`
- Modify: `components/Dashboard.tsx`(배치, 기본 state `presetRange("today", ...)`), `components/dash/ui.tsx`(채널 색 확정)
- Delete: `components/ChannelSection.tsx` (`SetSales`나 다른 파일이 쓰는 export(`NUM`, `man`, `fmtDay` 등)는 `components/dash/ui.tsx`로 옮기고 import 경로 수정)

**Interfaces:**
- Consumes: `channelMix`(Task 7), `SERIES`, `SectionHead`, `CARD`
- Produces: `RevenueSources(props: { data: ChannelsData | null; loading: boolean; theme: "light" | "dark" })`

- [ ] **Step 1:** 색 확정: 인접 쌍(메타–검색, 검색–미귀속, 미귀속–자사 SNS, 자사 SNS–레퍼럴, 레퍼럴–인플루언서, 인플루언서–검색광고)을 dataviz 검사기로 라이트(바탕 #FFFFFF)와 다크(바탕 #12151C) 각각 실행해 모두 PASS 인 값만 쓴다. 명령: `node "C:/Users/justi/AppData/Local/Temp/claude/bundled-skills/2.1.323/36e34b21265d45a268ef4e0add9c611d/dataviz/scripts/validate_palette.js" "<hex,hex>" --mode dark --surface "#12151c"`.
- [ ] **Step 2:** 설계 문서 5번 그대로 구현(묶음 괄호, 100% 막대, 표 7줄, 0원 회색, 상관 0.97 문장). 신규 고객 토글 삭제.
- [ ] **Step 3:** 기본 기간을 오늘로.
- [ ] **Step 4:** `npx tsc --noEmit -p .`, 테스트 4개, `npm run build`. **Step 5: Commit** — `feat: 매출 출처와 기본 기간 오늘, 옛 채널 성과 삭제`

### Task 10: PR B 내보내기 — Task 6과 같은 절차. 운영 확인에 추가: 7일 보기 메타 ROAS, 실제 돈 확인, 캠페인 판정이 PR #55 화면과 같음, 오늘 보기에서 판정 칩과 실제 돈 확인 초록과 빨강과 캠페인 판정 칩이 안 보임, 캠페인 표 CTR, CPM, 일 예산 = `/api/dashboard/meta-campaigns`.

## PR C — 30일 추이와 마무리 (새 브랜치 `feat/dashboard-redesign-c`)

### Task 11: 최근 30일 추이 (`components/dash/Trend30.tsx`)

**Files:**
- Create: `components/dash/Trend30.tsx`
- Modify: `components/Dashboard.tsx` (어제까지 30일 `/api/dashboard/daily` 별도 호출, 스위치에 맞게 `dailyWithMarketing`)

**Interfaces:**
- Consumes: `presetRange("month30", today)`(Task 1), `SERIES`, `SectionHead`, `CARD`
- Produces: `Trend30(props: { rows: DailyRow[]; theme: "light" | "dark" })`

- [ ] **Step 1:** recharts로 위 선 차트(결제매출, 광고비, 한 축, 만 원 눈금, 오른쪽 끝 마지막 값), 아래 막대 차트(공헌이익, 음수 0선 아래), 두 차트 `syncId`로 같은 날 툴팁(날짜, 결제매출, 광고비, 공헌이익, MER). 범례 3개. 모바일에서 막대 라벨 숨김.
- [ ] **Step 2:** `npx tsc --noEmit -p .`, `npm run build`. **Step 3: Commit** — `feat: 최근 30일 추이(매출과 광고비 선, 공헌이익 막대)`

### Task 12: 접힘 정리, 휴대폰 점검, PR C 내보내기

**Files:**
- Modify: `components/Dashboard.tsx` (세트 판매 `defaultOpen={false}`, 일별 손익 표 맨 아래 접힘, 출처 문구 한 줄 유지)

- [ ] **Step 1:** 접힘 정리 후 `npx tsc --noEmit -p .`, 테스트 4개, `npm run build`.
- [ ] **Step 2:** Task 6과 같은 절차로 내보내기. 운영 확인: 30일 추이 마지막 날 = 어제, 일별 값 = `/api/dashboard/daily`, 390px 라이트와 다크에서 가로 넘침 0, 모든 기간 버튼과 스위치와 테마를 한 번씩 눌러 오류 없음.
- [ ] **Step 3:** 메모리(`finance-dashboard-source.md`)에 PR 번호, 머지 커밋, 운영 확인 숫자 기록.
