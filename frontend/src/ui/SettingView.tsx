"use client";

/* Setting — 다른 화면이 읽는 값을 정하는 자리 [OWNER, 2026-08-14].
 *
 * 지금은 조달금리 하나뿐이다. 데이터 화면이 아니라 **계산 규약**을 정하는
 * 자리라 최상위 섹션이고, 여기서 고른 값은 `state/funding.ts` 에 남아 Cash
 * Bond 백테스트 요청에 실려 간다.
 *
 * 화면이 값을 저장하지 서버가 저장하지 않는다. 서버 쪽 `/api/settings/funding`
 * 은 "그 스펙이 유효한가, 지금 몇 %인가" 만 답한다 — 그래서 이 화면은 고르는
 * 즉시 그 답을 다시 물어 **출처를 보여 준다**. 조달금리는 손익을 직접 움직이는
 * 숫자라, 어느 시계열의 어느 구간을 쓰는지가 화면에 없으면 안 된다.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { fetchFundingSettings } from "@/lib/api";
import {
  FUNDING_DEFAULT,
  SPREAD_MAX,
  SPREAD_MIN,
  useFundingStore,
  type FundingBasis,
} from "@/state/funding";

import { Field, INPUT } from "./formKit";
import { GroupBox, GroupBoxTitle } from "./GroupBox";
import { PAGE_X } from "./pageGutter";

const BASIS_NOTE: Record<FundingBasis, string> = {
  base: "한국은행이 정한 기준금리예요. 금통위가 바꾼 날에만 계단으로 움직여요.",
  call: "시장에서 실제로 거래된 하루짜리 금리예요. 매일 조금씩 움직여요.",
};

export function SettingView() {
  const basis = useFundingStore((s) => s.basis);
  const spreadBp = useFundingStore((s) => s.spreadBp);
  const setBasis = useFundingStore((s) => s.setBasis);
  const setSpreadBp = useFundingStore((s) => s.setSpreadBp);
  const reset = useFundingStore((s) => s.reset);
  const hydrate = useFundingStore((s) => s.hydrate);

  // 저장소 읽기는 마운트 뒤에 — SSR 과 첫 페인트의 마크업을 같게 두려고
  // 초기값을 상수로 두고 여기서 한 번 맞춘다 (state/funding.ts 의 주석).
  useEffect(() => hydrate(), [hydrate]);

  const { data, isError, error } = useQuery({
    queryKey: ["funding-settings", basis, spreadBp],
    queryFn: () => fetchFundingSettings({ basis, spreadBp }),
    retry: 1,
  });

  const isDefault =
    basis === FUNDING_DEFAULT.basis && spreadBp === FUNDING_DEFAULT.spreadBp;

  return (
    <div className={`min-h-0 flex-1 overflow-y-auto pt-4 ${PAGE_X}`}>
      <div className="max-w-[42rem]">
        <GroupBox header={<GroupBoxTitle>조달금리</GroupBoxTitle>}>
          <div className="p-3">
          <p className="text-[14px] opacity-60">
            현금채권은 원금을 빌려서 사요. 그 이자를 빼야 손익이 실제로 번 돈이
            돼요. 여기서 정한 값은 Cash Bond 백테스트에만 쓰여요.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-5">
            <Field label="기준">
              {/* 둘 중 하나 — 세그먼트가 아니라 라디오 두 개다. 선택지가 둘뿐이고
                  각자 설명이 붙으므로, 칸을 나눠 놓는 편이 무엇을 고르는지가
                  분명하다. */}
              <div className="flex gap-1">
                {(["base", "call"] as FundingBasis[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={basis === b}
                    onClick={() => setBasis(b)}
                    className={`h-6 rounded-control px-3 text-[14px] font-medium transition-colors ${
                      basis === b
                        ? "bg-accent text-on-accent"
                        : "bg-tile text-ink hover:bg-ink-5"
                    }`}
                  >
                    {b === "base" ? "기준금리" : "콜금리"}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="스프레드">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step={1}
                  min={SPREAD_MIN}
                  max={SPREAD_MAX}
                  value={spreadBp}
                  onChange={(e) => setSpreadBp(Number(e.target.value))}
                  className={`${INPUT} w-24 text-right`}
                />
                <span className="text-[15px] opacity-55">bp</span>
              </div>
            </Field>

            {!isDefault && (
              <button
                type="button"
                onClick={reset}
                className="h-6 text-[13px] opacity-55 underline-offset-2 hover:underline hover:opacity-90"
              >
                기본값으로
              </button>
            )}
          </div>

          <p className="mt-2 text-[13px] opacity-50">{BASIS_NOTE[basis]}</p>

          {/* 출처. 이 숫자가 어느 시계열의 어느 구간에서 왔는지를 화면이
              말한다 — 조달은 손익을 직접 움직이므로 근거가 보이지 않으면 안
              된다. */}
          <div className="mt-4 border-t border-edge pt-3 text-[14px]">
            {isError ? (
              <p className="opacity-60">
                조달 시계열을 읽지 못했어요. 백엔드가 필요한 화면이에요.
                <span className="ml-1 opacity-70">
                  ({error instanceof Error ? error.message : "알 수 없는 오류"})
                </span>
              </p>
            ) : !data ? (
              <p className="opacity-50">불러오는 중이에요…</p>
            ) : (
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                <dt className="opacity-50">지금 조달금리</dt>
                <dd className="font-semibold tabular-nums">
                  {data.latest.toFixed(3)}%
                  <span className="ml-1.5 font-normal opacity-55">= {data.label}</span>
                </dd>
                <dt className="opacity-50">시계열 구간</dt>
                <dd className="tabular-nums opacity-80">
                  {data.from} ~ {data.to}
                </dd>
                <dt className="opacity-50">구간 밖</dt>
                <dd className="opacity-80">
                  가장 가까운 끝값을 그대로 이어써요.
                </dd>
              </dl>
            )}
          </div>
          </div>
        </GroupBox>

        <p className="mb-6 mt-3 text-[13px] opacity-45">
          조달비용은 <b>초기 투자금액</b>에 실경과일수 ÷ 365 로 붙어요. 이표를
          받아도 줄지 않아요 — 매수금액을 텀 레포로 통째로 조달한다고 봐요.
          매도 포지션에는 붙지 않아요: 공매도는 돈이 아니라 채권을 빌리는
          것이고, 그 비용은 이 화면이 아는 값이 아니에요.
        </p>
      </div>
    </div>
  );
}
