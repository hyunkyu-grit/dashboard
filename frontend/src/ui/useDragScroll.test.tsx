// @vitest-environment jsdom
/* 가로 드래그 팬의 계약 [OWNER, 2026-08-12 — "좌우로 드래그하는 부분을
 * 만들어서 잘리는 부분도 볼 수 있게"].
 *
 * 넷을 못박는다: ① 마우스 드래그가 scrollLeft 를 시작점 − dx 로 옮긴다,
 * ② 문턱(4px) 안쪽은 클릭으로 남는다, ③ 문턱을 넘은 제스처의 클릭 **하나**는
 * 삼켜진다(팬을 끝낸 손이 버튼을 누른 셈이 되면 안 된다), ④ 터치는 건드리지
 * 않는다(브라우저 팬이 원래 있다). jsdom 은 레이아웃이 없지만 scrollLeft
 * 대입은 보존하므로 팬 수식을 그대로 단언할 수 있다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { useDragScroll } from "./useDragScroll";

afterEach(cleanup);

function Pane({ onPress }: { onPress: () => void }) {
  const { ref, handlers } = useDragScroll<HTMLDivElement>();
  return (
    <div data-testid="pane" ref={ref} {...handlers}>
      <button type="button" onClick={onPress}>
        누르기
      </button>
    </div>
  );
}

const mouse = { pointerType: "mouse", button: 0, buttons: 1 };

describe("useDragScroll", () => {
  it("마우스 드래그가 scrollLeft 를 시작점 − dx 로 옮긴다", () => {
    const { getByTestId } = render(<Pane onPress={() => {}} />);
    const pane = getByTestId("pane");
    fireEvent.pointerDown(pane, { ...mouse, clientX: 200 });
    fireEvent.pointerMove(pane, { ...mouse, clientX: 120 });
    expect(pane.scrollLeft).toBe(80);
    fireEvent.pointerMove(pane, { ...mouse, clientX: 260 });
    expect(pane.scrollLeft).toBe(-60); // 실 브라우저는 0 으로 클램프한다
  });

  it("문턱 안쪽 제스처는 클릭으로 남는다", () => {
    const press = vi.fn();
    const { getByTestId, getByRole } = render(<Pane onPress={press} />);
    const pane = getByTestId("pane");
    fireEvent.pointerDown(pane, { ...mouse, clientX: 100 });
    fireEvent.pointerMove(pane, { ...mouse, clientX: 102 }); // 4px 미만
    fireEvent.pointerUp(pane, { pointerType: "mouse" });
    expect(pane.scrollLeft).toBe(0);
    fireEvent.click(getByRole("button"));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("팬을 끝낸 제스처의 클릭 하나만 삼켜진다", () => {
    const press = vi.fn();
    const { getByTestId, getByRole } = render(<Pane onPress={press} />);
    const pane = getByTestId("pane");
    fireEvent.pointerDown(pane, { ...mouse, clientX: 100 });
    fireEvent.pointerMove(pane, { ...mouse, clientX: 40 });
    fireEvent.pointerUp(pane, { pointerType: "mouse" });
    fireEvent.click(getByRole("button")); // 제스처의 꼬리 — 죽는다
    expect(press).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button")); // 새 클릭 — 산다
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("터치 포인터는 건드리지 않는다 — 브라우저 팬의 몫", () => {
    const { getByTestId } = render(<Pane onPress={() => {}} />);
    const pane = getByTestId("pane");
    fireEvent.pointerDown(pane, { pointerType: "touch", button: 0, buttons: 1, clientX: 200 });
    fireEvent.pointerMove(pane, { pointerType: "touch", buttons: 1, clientX: 100 });
    expect(pane.scrollLeft).toBe(0);
  });
});
