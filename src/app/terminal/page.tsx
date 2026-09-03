import { TerminalShell } from '@/terminal/TerminalShell';

/**
 * 팔란티어풍 터미널 **목업** 라우트. `/chart`·`/scale` 과 같은 층의 하네스이고,
 * 상단 내비(`ui/nav.ts`)에 등록하지 않는다 — 등록은 이 화면이 제품이 됐다는
 * 뜻이고, 지금은 아니다.
 */
export default function TerminalPage() {
  return <TerminalShell />;
}
