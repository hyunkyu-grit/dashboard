/** 날짜 산술. 전부 ISO "YYYY-MM-DD" 문자열이고 UTC로 계산한다.
 *
 * 로컬 시간대를 쓰면 자정 근처에서 하루가 밀린다 — 기준일은 호가를 찾는 키라,
 * 하루가 밀리면 주말로 떨어져 스왑이 통째로 제외되는 데까지 간다. */

const DAY_MS = 86_400_000;

export function addDaysIso(iso: string, n: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

export function diffDaysIso(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

export function isValidIso(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso));
}

/** 서울 달력 기준의 오늘.
 *
 * `toISOString().slice(0,10)`은 UTC 날짜를 준다. 그러면 09:00 KST 이전의 실행이
 * **전날**로 해석되고, 월요일 아침이면 일요일이 되어 비영업일 오류로 스왑 북이
 * 통째로 사라진다. 실제로 겪은 결함이라 여기 남긴다.
 *
 * 시간대 변환만 한다 — 영업일 스냅은 하지 않는다. 주말에 실행하면 주말 날짜가
 * 그대로 나오고, 백엔드가 정직하게 "그날 호가 없음"이라고 답한다. 영업일
 * 판정의 권위는 백엔드의 달력 하나뿐이어야 한다. */
export function todayInSeoul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
