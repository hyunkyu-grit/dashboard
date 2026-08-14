/* 컨트롤 문법 한 벌 — 텍스트 필드 · 팝업 버튼 · 라벨 붙은 칸.
 *
 * (BacktestWindow.tsx 에서 추출, 2026-08-14 — Cash Bond 와 Setting 이 같은
 * 컨트롤을 쓰기 시작하면서 "창"에서 폼 원시요소를 임포트하게 됐다. `krw.ts`
 * 를 뽑을 때와 같은 이유이고 같은 처리다: 값·모양 불변, 자리만 유틸로.)
 *
 * 여기 있는 숫자는 전부 킷에서 왔다 — 새로 고르지 말고, 바꿔야 하면 킷을
 * 다시 읽고 그 근거를 주석에 남길 것.
 */

/* Text field, resolved off the kit (Text Fields - 3 Rg): the field is the TILE
 * surface with a 1px hairline at ink 5 percent and r=6, its text sits 6px in at
 * Medium 13, and focus is a 3.5px ring at 50 percent — not the 2px/15 percent
 * ring this had. The kit draws that ring in the ACCENT and it does so here too
 * now [OWNER, 2026-08-06]: the earlier pass left it ink because a blue ring sits
 * beside blue change numbers, and the owner ruled that acceptable — a ring
 * surrounds a control, a number does not, so the two do not compete. The hue is
 * this product's blue, not the kit's. */
/* h-6 is the kit's 3 Rg, and it is what makes the row line up: the field was
 * rendering 27.5px next to 24px pop-up buttons in the same row, so the two
 * controls' top and bottom edges sat ~1.75px apart on both sides. Same defect
 * class as the stepper that was a rung low — each value came from the kit, but
 * from different rungs. */
export const INPUT =
  "h-6 rounded-control bg-tile px-1.5 text-[14px] font-medium tabular-nums " +
  "outline-none ring-1 ring-inset ring-ink/[0.05] " +
  "focus:ring-[3.5px] focus:ring-down/50";

/* A <select> is a POP-UP BUTTON in the kit, not a text field, and the two do not
 * share a shape: the pop-up carries the chevron and the field does not. Both were
 * on INPUT before.
 * NOT a capsule. Looked at again in Sketch Cloud at 800 percent, size by size:
 * Pop-up Buttons 3 Rg (120x24) is a rounded RECTANGLE and 4 Lg (120x28) is the
 * first capsule — the same 28 boundary the Buttons and Segmented families draw.
 * The pass that made every control a capsule read the 28/36 artboards and called
 * it a rule; 24 has a long flat run on every edge. */
export const POPUP =
  "kit-button rounded-control px-3 text-[14px] font-medium tabular-nums " +
  "outline-none focus:ring-[3.5px] focus:ring-down/50";

/** 라벨이 위, 컨트롤이 아래. 라벨은 13px 50% — 값보다 확실히 뒤로 물러난다. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] opacity-50">{label}</span>
      {children}
    </label>
  );
}
