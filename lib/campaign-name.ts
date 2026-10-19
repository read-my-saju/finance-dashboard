/** 캠페인 표(TOP10·채널 성과)에서 긴 캠페인 이름의 공통 단어를 떼어 보여주기 위한 도우미. */

// 단어 경계: _ - 공백, 그리고 영문↔한글이 붙은 곳 ("rebranding판매" 처럼 _ 를 빠뜨린 이름).
const words = (name: string): string[] =>
  name.replace(/([A-Za-z])(?=[가-힣])|([가-힣])(?=[A-Za-z])/g, "$1$2_").split(/[_\-\s]+/).filter(Boolean);

// 모든 이름에 들어 있는 단어. 접두어가 아니어도 된다 — 26_3Q_… 와 26_4Q_… 가 섞이면 공통 접두어는 "26" 뿐이라 축약이 안 됨.
// 캠페인 1개면 빈 집합 (축약 안 함).
export function commonCampaignWords(names: string[]): Set<string> {
  if (names.length < 2) return new Set();
  const [first, ...rest] = names.map((n) => new Set(words(n)));
  return new Set(Array.from(first).filter((w) => rest.every((s) => s.has(w))));
}

// 공통 단어를 뺀 이름. 남는 게 없으면 원래 이름.
export function shortCampaignName(name: string, common: Set<string>): string {
  if (common.size === 0) return name;
  return words(name).filter((w) => !common.has(w)).join("_") || name;
}
