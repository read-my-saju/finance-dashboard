/**
 * 세트 결제 구분. Mixpanel 결제 이벤트(s2s_purchase_verified)에는 세트 필드가 없고
 * report_type(결제창 = 첫 리포트)과 금액만 있어서, 그 조합으로 판정한다 (2026-09-01~10-23 실측 조합).
 * 이름은 운영 번들 이름 그대로 (사장님 10/15 지시).
 *
 * ponytail: 금액 고정표 — 할인 코드가 붙거나 세트 가격이 바뀌면 단품으로 잡힘.
 *           백엔드가 결제 이벤트에 세트 이름을 실어 주면 그 값으로 교체.
 */
const SET_BY_TYPE_AMOUNT: Record<string, string> = {
  "LIFE_REPORT_V3:44900": "인생+신년운세 세트",
  "NEWYEAR_2027:44900": "인생+신년운세 세트",
  "LIFE_REPORT_V3:49900": "인생+연애운 세트",
  "LOVE_FORTUNE:49900": "인생+연애운 세트",
  "LOVE_FORTUNE:64900": "연애+궁합운 세트",
  "COMPATIBILITY:64900": "연애+궁합운 세트",
  "LOVE_FORTUNE:42900": "연애+궁합운 세트", // 10/12~14 옛 가격
  "LIFE_REPORT_V3:42900": "인생+수능운 세트", // 10/11~15 판매 후 내림
  "COMPATIBILITY:59900": "궁합+신년운세 세트",
};

export function setNameOf(reportType: string | undefined, amount: number | undefined): string | null {
  if (!reportType || !amount) return null;
  return SET_BY_TYPE_AMOUNT[`${reportType}:${amount}`] ?? null;
}
