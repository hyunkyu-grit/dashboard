/**
 * 대기 표시기. **킷의 심볼을 그대로 옮긴 것**이다 —
 * `Progress Indicators/Light/Content Area/Circular/Indeterminate/3 Rg` (32×32):
 *
 *   rectangle 1   x=14    y=0      4×10   #000/0.55   r pill
 *   rectangle 2   x=21.78 y=3.22   4×10   #000/0.06
 *   rectangle 3   x=25    y=11     4×10   #000/0.13
 *   rectangle 4   x=21.78 y=18.78  4×10   #000/0.20
 *   rectangle 5   x=14    y=22     4×10   #000/0.27
 *   rectangle 6   x=6.22  y=18.78  4×10   #000/0.34
 *   rectangle 7   x=3     y=11     4×10   #000/0.41
 *   rectangle 8   x=6.22  y=3.22   4×10   #000/0.48
 *
 * 좌표를 옮겨 적지 않고 **각도로 다시 세운다**: 1번이 12시고 45°씩 시계방향으로
 * 8개다. 좌표를 그대로 쓰면 32 크기에 묶이는데, 각도로 두면 크기가 자유롭다.
 *
 * 불투명도 순서가 이 컴포넌트의 전부다. 가장 진한 칸(0.55)이 머리고, 바로
 * **시계방향 다음 칸이 가장 옅다**(0.06). 즉 꼬리가 반시계로 끌리고 회전은
 * 시계방향이다. 이걸 뒤집으면 같은 그림이 반대로 도는 것처럼 보인다.
 *
 * 회전은 매끈하지 않고 8칸을 딛는다 — macOS가 그렇게 돈다. `steps(8)`.
 */

const SPOKE_ALPHA = [0.55, 0.06, 0.13, 0.2, 0.27, 0.34, 0.41, 0.48];

/** 32 기준 비율. 킷 값 그대로: 폭 4/32, 길이 10/32. */
const W = 4 / 32;
const L = 10 / 32;

export function Spinner({ size = 32, label = "계산 중" }: { size?: number; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block animate-spinner-step"
      style={{ width: size, height: size, position: "relative" }}
    >
      {SPOKE_ALPHA.map((alpha, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: size * W,
            height: size * L,
            borderRadius: size * W,
            background: "var(--bw-ink)",
            opacity: alpha,
            // 상자 한가운데를 축으로 45°씩. translateX(-50%)가 먼저 와야
            // 회전축이 살(spoke)의 중심선에 놓인다.
            transform: `translateX(-50%) rotate(${i * 45}deg)`,
            transformOrigin: `50% ${size / 2}px`,
          }}
        />
      ))}
    </span>
  );
}
