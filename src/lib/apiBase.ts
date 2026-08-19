/* 백엔드 주소가 정해지는 **단 한 곳**.
 *
 * 배포 형태 [OWNER, 2026-08-20]: 프런트는 Vercel, 계산은 Tailscale Funnel 로
 * 공개한 :8200 백엔드. 그러면 브라우저가 다른 출처로 나가야 하고, 그 출처를
 * 아는 방법은 빌드 시각에 박히는 `NEXT_PUBLIC_API_BASE` 하나뿐이다.
 *
 * ## 미설정일 때
 *
 * 개발(`next dev`, vitest)에서는 `http://localhost:8200` 으로 떨어진다 — 옆에
 * 백엔드를 띄워 두고 일하는 것이 이 리포의 기본 자세다.
 *
 * **프로덕션 빌드에서 미설정이면 던진다.** v1 의 실제 사고가 이것이었다:
 * 값이 없으면 조용히 localhost 로 떨어지고, 그 문자열이 그대로 번들에 구워져
 * 배포되고, 방문자의 브라우저가 자기 PC 의 :8200 을 두드리다 실패했다. 아무도
 * 안 죽었기 때문에 아무도 몰랐다. 여기서는 `next build` 가 죽는다 —
 * 조용한 잘못보다 시끄러운 실패가 낫다.
 *
 * 백엔드 없이 프로덕션 빌드를 내야 할 때는 **빈 문자열을 명시**한다
 * (`NEXT_PUBLIC_API_BASE=`). 그건 "같은 출처로만 나간다"는 뜻이고
 * (`staticPaths.ts::IS_STATIC`), 백엔드가 필요한 화면은 404 를 받아
 * "백엔드가 필요한 화면이에요" 패널이 된다. 그 선택은 타이핑으로 남는다.
 */

/** `next build`/`next start` 가 켜는 값. vitest 는 `test` 라 여기 안 걸린다. */
const IS_PRODUCTION_BUILD = process.env.NODE_ENV === "production";

/** 미설정 시 개발에서만 쓰는 기본값. 프로덕션에서는 절대 쓰이지 않는다. */
export const DEV_FALLBACK_API_BASE = "http://localhost:8200";

export const MISSING_API_BASE_MESSAGE =
  "NEXT_PUBLIC_API_BASE 가 없습니다. 프로덕션 빌드는 백엔드 주소를 " +
  "빌드 시각에 박아야 하고, 없으면 localhost 로 조용히 떨어지는 대신 여기서 " +
  "멈춥니다. Funnel 주소를 넣거나(예: https://<host>.ts.net), 백엔드 없이 " +
  "굽겠다면 빈 문자열을 명시하세요(NEXT_PUBLIC_API_BASE=).";

/** 끝의 `/` 를 떼어 낸다 — 호출부는 전부 `${base}/api/...` 로 잇는다. */
function normalize(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function resolve(): string {
  /* `process.env.NEXT_PUBLIC_*` 는 번들러가 **텍스트로 치환**한다. 변수에 담아
   * 읽으면 치환이 일어나지 않으므로, 이 한 줄이 리터럴 접근이어야 한다. */
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (raw === undefined) {
    if (IS_PRODUCTION_BUILD) throw new Error(MISSING_API_BASE_MESSAGE);
    return DEV_FALLBACK_API_BASE;
  }
  return normalize(raw);
}

/** 백엔드의 출처. 빈 문자열이면 같은 출처(=정적/프록시 모드)라는 뜻이다. */
export const API_BASE = resolve();
