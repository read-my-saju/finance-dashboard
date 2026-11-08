/**
 * PG 수수료 기준 검증 (테스트 러너 없음 — node:assert 단일 파일).
 *
 * 실행:
 *   npx tsc lib/calc.test.ts --outDir .test-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node && node .test-out/calc.test.js
 *
 * 근거: PG 는 실제 결제금액(VAT 포함) 전체에 요율을 매긴다.
 *   토스 정산 객체: payOutAmount = amount(결제금액) − fee. 수수료 부가세는 별도(supplyAmount + vat).
 *   945,000 × 3.2% = 30,240. (VAT 제외 859,091 × 3.2% = 27,491 은 틀린 값)
 */
import assert from "node:assert/strict";
import { calc, pgFeeRateForMethodOnDate, reportCostPerUnitAt, reportCostPerUnitForDate } from "./calc";
import { computeProfit } from "./profit";
import { AI_API_PAYMENTS, BRANDING_COSTS, NAVER_AD_COSTS, SEEDING_COSTS, marketingByDay, spreadByMonth, totalInRange } from "./manual-costs";

const r = calc({ netRevenue: 945_000, adSpend: 0, reportCount: 0, pgFeeRate: 0.032, reportCostPerUnit: 0 });
assert.equal(Math.round(r.pgFee), 30_240, `calc.pgFee=${r.pgFee}`);

const p = computeProfit({
  payments: [
    {
      id: "p1",
      status: "PAID",
      paidAt: "2026-08-01T12:00:00+09:00",   // 6/19~8/13 구간: 3.2%
      amount: { total: 945_000 },
      method: { type: "CARD" },
    } as any,
  ],
  metaByDay: [],
  range: { from: "2026-08-01", until: "2026-08-01" },
});
assert.equal(Math.round(p.totals.pgFee), 30_240, `profit.totals.pgFee=${p.totals.pgFee}`);
assert.equal(Math.round(p.daily[0].pgFee), 30_240, `profit.daily.pgFee=${p.daily[0].pgFee}`);
// 화면 "PG X.XX%" 는 결제매출(VAT 포함) 대비 실효요율.
assert.equal(p.settings.pgFeeRate.toFixed(4), "0.0320", `settings.pgFeeRate=${p.settings.pgFeeRate}`);

// 결제일별 요율 분기: ~6/18 3.52% / 6/19~ 3.2% 일괄 (이체는 2.0%)
assert.equal(pgFeeRateForMethodOnDate("신용카드", "2026-06-18"), 0.0352);
assert.equal(pgFeeRateForMethodOnDate("신용카드", "2026-08-13"), 0.032);
assert.equal(pgFeeRateForMethodOnDate("간편결제", "2026-09-01"), 0.032);
assert.equal(pgFeeRateForMethodOnDate("계좌이체", "2026-09-01"), 0.02);

// 리포트 건당 원가(월별 실사용): 7월 870 / 8월 750 / 9월 1,590 / 10월~ 1,590원
assert.equal(reportCostPerUnitForDate("2026-07-31"), 870);
assert.equal(reportCostPerUnitForDate("2026-08-01"), 750);
assert.equal(reportCostPerUnitForDate("2026-08-31"), 750);
assert.equal(reportCostPerUnitForDate("2026-09-01"), 1590);
assert.equal(reportCostPerUnitForDate("2026-09-30"), 1590);
// 2026-10-01~10-10 건당 1,500원, 10-11~ 500원
assert.equal(reportCostPerUnitForDate("2026-09-30"), 1590);
assert.equal(reportCostPerUnitForDate("2026-10-01"), 1500);
assert.equal(reportCostPerUnitForDate("2026-10-10"), 1500);
assert.equal(reportCostPerUnitForDate("2026-10-11"), 500);
assert.equal(reportCostPerUnitForDate("2026-11-08"), 500);

// 실제 정산 메일 재현: 매출일 2026-08-13 매출액 1,778,260 → PG이용료 56,978 (오차 1% 이내)
const s = computeProfit({
  payments: [
    { id: "s1", status: "PAID", paidAt: "2026-08-13T12:00:00+09:00", amount: { total: 1_778_260 }, method: { type: "CARD" } } as any,
  ],
  metaByDay: [],
  range: { from: "2026-08-13", until: "2026-08-13" },
});
assert.ok(Math.abs(s.totals.pgFee - 56_978) / 56_978 < 0.01, `settlement 2026-08-13 pgFee=${s.totals.pgFee}`);

assert.equal(reportCostPerUnitAt("2026-09-30", Date.parse("2026-09-30T23:59:59+09:00")), 1590);
assert.equal(reportCostPerUnitAt("2026-10-10", Date.parse("2026-10-10T21:00:00+09:00")), 1500);
assert.equal(reportCostPerUnitAt("2026-10-11", Date.parse("2026-10-11T00:00:00+09:00")), 500);

// 2026-10~: 리포트 원가 = API 결제액, 광고비 = 메타 + 시딩·네이버. 손으로 넣은 비용은 그 달 일수로 나눠 매일 넣는다.
const oct = { from: "2026-10-01", until: "2026-10-31" };
const sum = (rows: Array<{ spend: number }>) => Math.round(rows.reduce((s, r) => s + r.spend, 0));
// 10월 마케팅비 = 시딩 160만 + 브랜딩 220만 (콜보드 기본료는 브랜딩으로 분리, 2026-11-02 밤)
assert.equal(sum(spreadByMonth(SEEDING_COSTS, oct)), 1_600_000);
assert.equal(sum(spreadByMonth(BRANDING_COSTS, oct)), 2_200_000);
assert.equal(sum(marketingByDay(oct)), 3_800_000);
assert.equal(spreadByMonth(SEEDING_COSTS, oct).length, 31, "10월 매일");
assert.equal(sum(marketingByDay({ from: "2026-10-05", until: "2026-10-05" })), 122_581);
assert.equal(sum(spreadByMonth(SEEDING_COSTS, { from: "2026-11-01", until: "2026-11-30" })), 11_000_000);
// 기간이 두 달에 걸치면 각 달 일수만큼: 10/27~11/2 = 10월 5일 + 11월 2일
assert.equal(sum(marketingByDay({ from: "2026-10-27", until: "2026-11-02" })), Math.round((3_800_000 / 31) * 5 + (11_000_000 / 30) * 2));
assert.equal(marketingByDay({ from: "2026-12-01", until: "2026-12-31" }).length, 0);
assert.equal(Math.round(totalInRange(AI_API_PAYMENTS, { from: "2026-10-01", until: "2026-10-31" })), 0, "10월 API 결제액은 건당 원가에 포함");
assert.equal(Math.round(totalInRange(NAVER_AD_COSTS, { from: "2026-08-01", until: "2026-09-30" })), 50_166, "광고센터 소진 합계");
const m = computeProfit({
  payments: [
    { id: "a", status: "PAID", paidAt: "2026-10-02T12:00:00+09:00", amount: { total: 1_100_000 }, method: { type: "TRANSFER" } } as any,
  ],
  metaByDay: [{ date: "2026-10-02", spend: 200_000 }],
  range: oct,
  extraAdByDay: marketingByDay(oct), // 화면에서 '시딩·브랜딩 포함'을 켠 경우
  extraReportCostByDay: spreadByMonth(AI_API_PAYMENTS, oct),
});
const d2 = m.daily.find((d) => d.date === "2026-10-02")!;
assert.equal(Math.round(d2.reportCost), 1500, "10/2 결제 1건 × 1,500");
assert.equal(Math.round(d2.adSpend), 200_000 + 122_581, "그날 메타 + 시딩 하루치");
const d31 = m.daily.find((d) => d.date === "2026-10-31")!;
assert.equal(Math.round(d31.reportCost), 0);
assert.equal(Math.round(d31.adSpend), 122_581, "말일에 몰리지 않음");
assert.equal(m.daily.length, 31, "결제·메타가 없는 날도 비용 행이 생김");
assert.equal(Math.round(m.totals.reportCost), 1500);
assert.equal(Math.round(m.totals.adSpend), 200_000 + 3_800_000);
assert.equal(Math.round(m.totals.extraAdSpend), 3_800_000);
// 일별 합 = 기간 합계
assert.equal(m.daily.reduce((s, d) => s + d.contributionProfit, 0).toFixed(2), m.totals.contributionProfit.toFixed(2));

// '시딩·브랜딩 포함' 꺼짐(기본)·켜짐: 광고비 차이 = 그 기간 시딩 + 브랜딩, 결제수수료·리포트 원가는 같음 (리뷰 MEDIUM)
const wk = { from: "2026-10-27", until: "2026-11-02" };
const base = { payments: [], metaByDay: [{ date: "2026-10-28", spend: 300_000 }], range: wk, extraReportCostByDay: spreadByMonth(AI_API_PAYMENTS, wk) };
const off = computeProfit({ ...base, extraAdByDay: spreadByMonth(NAVER_AD_COSTS, wk) });
const on = computeProfit({ ...base, extraAdByDay: [...spreadByMonth(NAVER_AD_COSTS, wk), ...marketingByDay(wk)] });
const mk = totalInRange(SEEDING_COSTS, wk) + totalInRange(BRANDING_COSTS, wk);
assert.equal(Math.round(off.totals.adSpend), 300_000, "꺼짐 = 메타(+네이버)만");
assert.equal(Math.round(on.totals.adSpend - off.totals.adSpend), Math.round(mk), "켜짐 차이 = 시딩 + 브랜딩");
assert.equal(Math.round(mk), Math.round((1_600_000 / 31 + 2_200_000 / 31) * 5 + (11_000_000 / 30) * 2));
assert.equal(on.totals.reportCost, off.totals.reportCost);

console.log("calc.test OK");
