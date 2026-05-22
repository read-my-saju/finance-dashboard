# ReadMySaju 결제 대시보드

PortOne V2 API 를 실시간으로 직접 호출해서 매출을 보여주는 **별도** 웹사이트입니다.
기존 `admin.readmysaju.com` 의 재무 대시보드와 분리되어 있고, Google Play / 인앱
결제는 표시하지 않습니다 (PortOne 경유 결제만).

- 기술: **Next.js 14** + Tailwind + Recharts
- 호스팅: **Vercel Hobby (무료)**
- 인증: **비밀번호 1개** (cookie 30일)
- 데이터: PortOne API → 5분 in-memory cache → 새로고침 버튼으로 즉시 무효화

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

### 2. 환경변수 3개 설정
같은 화면의 **Environment Variables** 섹션에서 아래 3개 추가:

| Name | Value |
|---|---|
| `PORTONE_API_KEY` | PortOne 콘솔의 **내 결제 → API Keys** 에서 발급한 V2 Secret Key (read-only 가능하면 권장) |
| `DASHBOARD_PASSWORD` | 본인이 정한 비밀번호 (예: 16자리 영문/숫자) |
| `SESSION_SECRET` | 아래 명령으로 생성된 무작위 hex 문자열 |

`SESSION_SECRET` 만들기 (어디서든 한 번 실행하면 됩니다):
```
openssl rand -hex 32
```
또는 https://generate-secret.vercel.app/32 에서 복사.

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

- 우측 상단 **새로고침** 버튼 → PortOne API 즉시 재호출 (캐시 무시)
- 좌측 상단 **기간 선택** → 거래액 / 순거래액 / 거래취소액 자동 갱신
- **결제수단별 TOP5** → 카카오페이 / KG이니시스 / PayPal 등 비중 막대 표시

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
