/**
 * Upstash Redis (구 Vercel KV) 어댑터.
 *
 * 환경변수 (Vercel Marketplace 의 Upstash Redis integration 이 자동 주입):
 *   KV_REST_API_URL              REST API endpoint URL
 *   KV_REST_API_TOKEN            REST API token
 *
 * 환경변수가 없으면 isKvEnabled() 가 false 를 반환 — 호출처는
 * 기존 in-memory cache fallback 으로 동작해야 한다. 절대 throw 하지 않음.
 *
 * 사용 시점:
 *   Meta 광고 인사이트의 일별 캠페인 데이터를 영속 저장해 rolling 7일
 *   incremental sync 가 cold start 를 가로질러 유효하게 한다.
 */

import { Redis } from "@upstash/redis";

let _client: Redis | null = null;

export function isKvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function kv(): Redis {
  if (!isKvEnabled()) {
    throw new Error(
      "KV_REST_API_URL / KV_REST_API_TOKEN 환경변수가 설정되지 않았습니다. " +
        "Vercel 프로젝트의 Storage > Redis (Upstash) integration 을 연결하세요.",
    );
  }
  if (!_client) {
    _client = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });
  }
  return _client;
}
