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
import { calc, pgFeeRateForMethodOnDate } from "./calc";
import { computeProfit } from "./profit";

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

// 실제 정산 메일 재현: 매출일 2026-08-13 매출액 1,778,260 → PG이용료 56,978 (오차 1% 이내)
const s = computeProfit({
  payments: [
    { id: "s1", status: "PAID", paidAt: "2026-08-13T12:00:00+09:00", amount: { total: 1_778_260 }, method: { type: "CARD" } } as any,
  ],
  metaByDay: [],
  range: { from: "2026-08-13", until: "2026-08-13" },
});
assert.ok(Math.abs(s.totals.pgFee - 56_978) / 56_978 < 0.01, `settlement 2026-08-13 pgFee=${s.totals.pgFee}`);

console.log("calc.test OK");
