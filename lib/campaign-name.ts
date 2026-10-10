/** 캠페인 표(TOP10·채널 성과)에서 긴 캠페인 이름의 공통 접두어를 떼어 보여주기 위한 도우미. */

// 캠페인 이름들의 최장 공통 접두어를 단어 경계(_ - 공백)에서 끊어 반환.
// 캠페인 1개거나 구분자를 포함한 공통 접두어가 없으면 "" (축약 안 함).
export function commonCampaignPrefix(names: string[]): string {
  if (names.length < 2) return "";
  const isSep = (ch: string) => ch === "_" || ch === "-" || ch === " ";
  let lcp = names[0];
  for (let i = 1; i < names.length; i++) {
    const n = names[i];
    let k = 0;
    while (k < lcp.length && k < n.length && lcp[k] === n[k]) k++;
    lcp = lcp.slice(0, k);
    if (!lcp) break;
  }
  // LCP가 어떤 이름에서 단어 중간(다음 문자가 구분자도 문자열 끝도 아님)에서 끊겼으면,
  // 마지막 구분자 앞까지 줄여 단어 경계를 맞춘다.
  const cleanBoundary = names.every((n) => n.length === lcp.length || isSep(n[lcp.length]));
  if (!cleanBoundary) {
    let end = lcp.length;
    while (end > 0 && !isSep(lcp[end - 1])) end--; // 마지막 구분자 다음 위치
    lcp = lcp.slice(0, Math.max(end - 1, 0)); // 구분자 자체 제외
  }
  while (lcp.length && isSep(lcp[lcp.length - 1])) lcp = lcp.slice(0, -1); // 끝 구분자 정리
  return /[_\-\s]/.test(lcp) ? lcp : ""; // 구분자 없는 짧은 접두어는 축약 이득 없음
}
