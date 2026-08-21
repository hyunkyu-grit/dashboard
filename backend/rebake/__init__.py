# -*- coding: utf-8 -*-
"""리베이크 파이프라인 — 엔진을 돌려 계약 산출물 한 벌을 원자적으로 쓴다.

    python -m rebake              굽는다
    python -m rebake --offline    캐시만
    python -m rebake --check      구워야 하나만 답한다

UI 는 이 패키지를 **import 하지 않는다.** `backend/output/*.json` 만 읽는다.
"""
