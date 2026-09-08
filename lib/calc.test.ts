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
import { calc } from "./calc";
import { computeProfit } from "./profit";

const r = calc({ netRevenue: 945_000, adSpend: 0, reportCount: 0, pgFeeRate: 0.032, reportCostPerUnit: 0 });
assert.equal(Math.round(r.pgFee), 30_240, `calc.pgFee=${r.pgFee}`);

const p = computeProfit({
  payments: [
    {
      id: "p1",
      status: "PAID",
      paidAt: "2026-09-01T12:00:00+09:00",
      amount: { total: 945_000 },
      method: { type: "CARD" },
    } as any,
  ],
  metaByDay: [],
  range: { from: "2026-09-01", until: "2026-09-01" },
});
assert.equal(Math.round(p.totals.pgFee), 30_240, `profit.totals.pgFee=${p.totals.pgFee}`);
assert.equal(Math.round(p.daily[0].pgFee), 30_240, `profit.daily.pgFee=${p.daily[0].pgFee}`);
// 화면 "PG X.XX%" 는 결제매출(VAT 포함) 대비 실효요율.
assert.equal(p.settings.pgFeeRate.toFixed(4), "0.0320", `settings.pgFeeRate=${p.settings.pgFeeRate}`);

console.log("calc.test OK");
