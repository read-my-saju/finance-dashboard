/**
 * 토스 거래 → 결제 변환 검증 (테스트 러너 없음 — node:assert 단일 파일).
 *
 * 실행:
 *   npx tsc lib/toss.test.ts --outDir .test-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node && node .test-out/toss.test.js
 *
 * 실데이터 2026-10-05 결제 19,900원이 10/8 에 환불된 건: 10/5 하루만 조회해도 환불이 빠져야 한다.
 */
import assert from "node:assert/strict";
import { tossToPortonePayments, type TossTransaction } from "./toss";

const txns: TossTransaction[] = [
  { paymentKey: "pk1", status: "DONE", amount: 19_900, transactionAt: "2026-10-05T18:18:59+09:00", currency: "KRW" },
  { paymentKey: "pk1", status: "CANCELED", amount: 19_900, transactionAt: "2026-10-08T18:55:01+09:00", currency: "KRW" },
  { paymentKey: "pk2", status: "DONE", amount: 29_900, transactionAt: "2026-10-05T20:00:00+09:00", currency: "KRW" },
  // 기간(10/5) 뒤에 승인된 결제 — 환불 확인용으로 받아왔을 뿐 매출 아님
  { paymentKey: "pk3", status: "DONE", amount: 29_900, transactionAt: "2026-10-06T09:00:00+09:00", currency: "KRW" },
];

const out = tossToPortonePayments(txns, { approvedUntil: "2026-10-05" });
assert.deepEqual(out.map((p) => [p.id, p.status]).sort(), [["pk1", "CANCELLED"], ["pk2", "PAID"]]);

// 옵션 없이 부르면 기존처럼 전부 변환
assert.equal(tossToPortonePayments(txns).length, 3);

console.log("toss.test OK");
