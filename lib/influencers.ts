/**
 * 인플루언서 할인 링크 → 이름. 정본은 캠페인 콘솔(campaign.readmysaju.com, '인플루언서'·'할인 링크 · UTM')이고
 * 2026-11-03 콘솔 목록(인플루언서 33명·링크 24개)을 옮겨 적었다. 콘솔에 새 인플루언서·링크를 만들면 여기 한 줄 추가.
 *
 * 결제 이벤트(s2s_purchase_verified)에는 할인이 적용되면 influencer_code(= 콘솔 인플루언서 코드)가,
 * 링크로 들어오면 utm_term(= 링크의 추적값)이 실린다. 둘 다 없으면 코드·추적값을 그대로 보여 준다.
 */

const BY_CODE: Record<string, string> = {
  "263Q_SS1": "263Q_SS1 인플시딩",
  ziwooney: "지우니",
  "ziwooney지우니": "지우니",
  "263Q_SS2": "죠대리",
  "263Q_bg": "허유나",
  "263Q_bg1": "이진희",
  "263Q_bg2": "이브 (블로그 체험단)",
  "263Q_Formme": "Formme",
  "263Q_INFL_IG": "3Q 인스타 시딩",
  "263Q_INFL_IG_Formme": "3Q 인스타 시딩 (Formme)",
  "263Q_chP": "추석맞이 10% 할인",
  "263Q_p": "푸리 고객",
  "264Q_CELEB_COLLAB_1": "박나언",
  "264Q_CELEB_COLLAB_2": "김고은",
  "264Q_CELEB_COLLAB_3": "최한나",
  "264Q_IG0": "현진",
  "264Q_IG1": "임뽀롱",
  "264Q_IG2": "홍이콩이",
  "264Q_IG3": "네이버 클립 크리에이터",
  "264Q_IG4": "리포포",
  "264Q_IG5": "유복림",
  "264Q_IG6": "won",
  "264Q_IG7": "현진",
  "264Q_RV_B1": "레뷰 베이직 1",
  "264Q_RV_B2": "레뷰 베이직 2",
  "264Q_RV_B3": "레뷰 베이직 3",
  "264Q_RV_B4": "레뷰 베이직 4",
  "264Q_RV_B5": "레뷰 베이직 5",
  "264Q_RV_P1": "레뷰 프리미어 1",
  "264Q_RV_P2": "레뷰 프리미어 2",
};

// 링크 추적값(utm_term) → 이름. 할인이 안 붙은 결제(토큰 유실 등)도 어느 링크로 왔는지 알 수 있다.
const BY_TERM: Record<string, string> = {
  "264qs_ybl": "유복림",
  "264qs_rpp": "리포포",
  "264qs_hj": "현진",
  "264qs4": "홍이콩이",
  "264qs1": "임뽀롱",
  ziwooney: "지우니",
};

/** 할인 코드(influencer_code) 또는 링크 추적값(utm_term)으로 인플루언서 이름. 모르면 undefined. */
export function influencerName(code?: string, term?: string): string | undefined {
  return (code && BY_CODE[code]) || (term && BY_TERM[term.toLowerCase()]) || undefined;
}
