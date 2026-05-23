# ReadMySaju 결제 · 광고 손익 대시보드

PortOne V2 결제 데이터와 Meta (Facebook/Instagram) 광고비를 **하나의 화면**에서
보고, 일별 **기여이익 / ROAS / 손익분기 ROAS** 를 자동 계산해 광고 의사결정
("증액 가능" vs "광고비 주의") 까지 제시하는 별도 웹사이트입니다.

기존 `admin.readmysaju.com` 의 재무 대시보드와 분리되어 있고, Google Play /
인앱 결제는 표시하지 않습니다 (PortOne 경유 결제만).

- 기술: **Next.js 14** (App Router) + TypeScript + Tailwind + Recharts
- 호스팅: **Vercel Hobby (무료)**
- 인증: **비밀번호 1개** (HMAC 서명 cookie 30일)
- 데이터: PortOne V2 + Meta Marketing API → 5분 in-memory cache → 새로고침 버튼으로 즉시 무효화
- 계산 공식: **`lib/calc.ts` 서버 유틸 단독 사용** (UI 에서 재계산 금지)

## 한눈에 보는 손익 공식

```
순거래액  = 결제완료금액 - 환불금액           (= PortOne netRevenue)
VAT       = 순거래액 × 10 / 110
PG 수수료  = 순거래액 × 3.52% (env 로 변경 가능)
보고서 ASP = 결제 건수 × 250원 (env 로 변경 가능)
기여이익   = 순거래액 - VAT - PG - 보고서 ASP - 광고비
ROAS      = 순거래액 / 광고비 × 100
손익분기 ROAS = 순거래액 / (순거래액 - VAT - PG - 보고서 ASP) × 100
```

ROAS 가 손익분기를 넘으면 **"증액 가능"**, 못 넘으면 **"광고비 주의"** 가
KPI 카드에 표시됩니다.

## 사장님이 처음 한 번만 하실 작업 (5분)

### 1. Vercel 로그인 → 새 프로젝트 import
1. https://vercel.com/new 접속
2. GitHub 계정으로 로그인 (이미 가입된 `readmysaju@gmail.com` 사용)
3. **`read-my-saju/finance-dashboard`** 저장소를 선택해 **Import**
   - 안 보이면 Vercel 상단의 *Adjust GitHub App Permissions* → 이 repo 권한 추가
4. **Configure Project** 단계가 바로 나옴:
   - **Framework Preset** = Next.js (자동 감지)
   - **Root Directory** 는 그대로 두기 (이 repo 의 root 가 곧 Next.js 프로젝트)
   - **Build / Output Directory** 도 기본값 그대로

### 2. 환경변수 설정
같은 화면의 **Environment Variables** 섹션에서 아래 변수를 추가합니다.

#### 필수

| Name | Value |
|---|---|
| `PORTONE_API_KEY` | PortOne 콘솔 → **결제 연동 → V2 API → API Secret** 에서 발급한 긴 random 문자열 |
| `PORTONE_STORE_ID` | 같은 화면의 `store-xxxxxxxx` 형식 Store ID |
| `META_ACCESS_TOKEN` | 페이스북 비즈니스 설정 → 시스템 사용자 → 토큰 생성. `ads_read` 권한 필수, long-lived 권장 |
| `META_AD_ACCOUNT_ID` | 광고관리자 좌측 상단 `act_숫자` 그대로 (또는 숫자만) |
| `DASHBOARD_PASSWORD` | 본인이 정한 비밀번호 (예: 16자리 영문/숫자) |
| `SESSION_SECRET` | `openssl rand -hex 32` 로 생성한 무작위 hex 문자열 |

#### 선택 (default 값 사용 시 생략 가능)

| Name | Default | 의미 |
|---|---|---|
| `META_API_VERSION` | `v21.0` | Graph API 버전 |
| `DEFAULT_PG_FEE_RATE` | `0.0352` | PG 수수료율 (계약 변경 시 조정) |
| `DEFAULT_REPORT_COST_PER_UNIT` | `250` | 보고서 1건당 LLM 비용 (원) |
| `DASHBOARD_TIMEZONE` | `Asia/Seoul` | 일별 집계 타임존 |

#### Meta 광고 incremental sync (권장 — 새로고침 비용 절감)

Vercel 프로젝트 → **Storage → Marketplace → Upstash Redis** integration 을
연결하면 다음 두 환경변수가 자동 주입됩니다. 별도 입력 불필요.

| Name | 의미 |
|---|---|
| `KV_REST_API_URL` | Upstash Redis REST endpoint (Vercel integration 이 자동 주입) |
| `KV_REST_API_TOKEN` | Upstash Redis REST token (Vercel integration 이 자동 주입) |

연결되면:
- 새로고침이 **rolling 7일 incremental sync** 로 동작 — 최근 7일만 Meta API 재호출, 7일 이전은 KV 저장본 그대로 사용.
- last_synced_at 이 KV 에 유지되어 cold start 를 가로질러 보존.
- Meta 어트리뷰션 윈도우 안에서 사후 갱신되는 전환/매출은 매번 덮어쓰기.

연결 안 해도 대시보드는 정상 동작합니다 — 새로고침 시 매번 풀 fetch 로 fallback.

> **보안**: 위 환경변수는 모두 **서버 사이드에서만** 사용합니다. `NEXT_PUBLIC_`
> 접두사를 절대 붙이지 마세요 — 붙는 순간 프론트엔드 번들에 평문으로 박혀
> 누구나 DevTools 에서 볼 수 있습니다.

`SESSION_SECRET` 만들기 (어디서든 한 번 실행하면 됩니다):
```
openssl rand -hex 32
```
또는 https://generate-secret.vercel.app/32 에서 복사.

### Meta 토큰 발급 상세 (한 번만)

1. https://business.facebook.com → **비즈니스 설정**
2. 좌측 **사용자 → 시스템 사용자 → 추가**
   - 이름: `dashboard-readonly` (임의)
   - 역할: 관리자
3. 생성된 시스템 사용자 선택 → **토큰 생성**
   - 앱: 본인 비즈니스에 연결된 앱 선택
   - 권한: **`ads_read`** (반드시 체크)
   - 만료: **만료 없음** 선택 권장
4. 생성된 토큰을 Vercel `META_ACCESS_TOKEN` 에 붙여넣기
5. 광고관리자에서 광고계정 ID (`act_숫자`) 를 복사해 `META_AD_ACCOUNT_ID` 에 입력

토큰이 만료되거나 권한이 부족하면 대시보드 상단에 **노란색 알림 배너**로
"Meta access token 이 만료되었습니다 — 재발급해주세요" 같은 사람이 읽을 수
있는 메시지가 표시됩니다. PortOne 데이터는 계속 정상 표시됩니다.

### 3. Deploy 버튼 클릭
약 1분 후 배포 완료.
- 기본 URL 예: `https://finance-dashboard-read-my-saju.vercel.app/`
- Vercel **Settings → Domains** 에서 `readmysaju-finance.vercel.app` 처럼
  이름을 바꾸거나 `finance.readmysaju.com` 같은 자체 도메인을 연결할 수 있음.

### 4. 접속 → 로그인 → 끝
- 첫 화면이 **로그인 페이지**
- 위에서 정한 `DASHBOARD_PASSWORD` 입력
- 30일 동안 같은 브라우저에서는 다시 안 물어봄
- 로그아웃은 우측 상단 버튼

## 평소 사용

- 우측 상단 **새로고침** 버튼 → PortOne + Meta API 즉시 재호출 (캐시 무시)
- 좌측 상단 **기간 선택** → 모든 KPI / 차트 / 표 자동 갱신
- **결제 거래** 섹션 (PortOne 콘솔과 1:1 일치)
  - 거래액 / 순거래액 / 거래취소액
  - 거래액 시계열 (일간/주간 토글)
  - 결제수단별 순거래액 TOP5
- **광고 손익** 섹션 (PortOne × Meta 결합)
  - KPI: 순거래액 / 광고비 / 기여이익 (흑자·적자 판단) / ROAS + 손익분기
  - **일별 손익 차트** — 막대(순거래액·광고비) + 라인(기여이익)
  - **ROAS vs 손익분기 차트** — 실선/점선 비교
  - **비용 구조** — VAT / PG / 보고서 / 광고비 가로 막대
  - **Meta 캠페인 표** — 광고비 큰 순. 컬럼: 결과(구매수) · CPA · 예산 · 지출금액 · ROAS · CTR · 빈도 · CVR · CPM
  - **일별 손익 표** — 최근 30일
  - **인사이트 패널** — "증액 가능" / "광고비 주의" 자동 권고

## 데이터 흐름

```
사용자 ──────► /api/payments          (PortOne raw 집계: 거래액/순/취소/TOP5)
브라우저 ─────► /api/dashboard/summary (lib/calc.ts 기간 KPI)
        ────► /api/dashboard/daily   (lib/profit.ts 일별 손익)
        ────► /api/dashboard/meta-campaigns (Meta 캠페인 집계)

서버 ── PortOne V2  /payments-by-cursor (cursor 페이지네이션, payment.id dedup)
     ── Meta Graph  /act_XXX/insights  (time_increment=1, level=campaign)
     ── in-memory 5분 cache (PortOne + Meta raw 공유)
     ── lib/calc.ts 단일 진실 공식
```

`lib/calc.ts` 는 **유일한 계산 모듈**입니다. UI 컴포넌트나 API route 에서
별도로 사칙연산을 하지 마세요 — 공식이 바뀌면 여기 한 군데만 바꿉니다.

## 비용

- **Vercel Hobby = 무료** (개인 비즈니스 모니터링 대시보드 트래픽 충분히 커버).
- PortOne API 는 결제 조회만 사용하므로 추가 비용 없음.

## 코드를 고친 경우

이 repo 의 파일을 수정 → `git push` → Vercel 이 자동으로 새 배포.

## 로컬에서 돌려보고 싶다면

```
cp .env.example .env.local
# .env.local 에 위 3개 값 채움
npm install
npm run dev
# → http://localhost:3000
```

## 보안 메모

- `DASHBOARD_PASSWORD` 만 알면 누구나 접속 가능. **추측 어렵게** 16자+ 권장.
- 세션 쿠키는 HttpOnly + Secure + SameSite=Lax.
- 본 repo 는 public 이지만 비밀(API key, 비밀번호) 은 모두 환경변수로만 다룬다.
- 더 강한 인증이 필요하면 (예: 사장님 1명만) Vercel **Access Protection** (유료)
  또는 OAuth 추가 가능 — 별도 PR.
