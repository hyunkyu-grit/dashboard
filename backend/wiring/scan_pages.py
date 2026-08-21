# -*- coding: utf-8 -*-
"""`wiring/paper_pages.py` 를 만드는 스캐너.

python -m wiring.scan_pages

**기호는 텍스트 추출로 죽지만 식 번호 `(N)` 은 살아 있다** — 배치를 읽을 때는
`pypdfium2` 로 페이지를 렌더해야 하지만, 번호만 세는 이 일은 텍스트로 된다.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

PDF = Path(os.path.expanduser("~/Downloads")) / "BOK 경제연구 제2025-3호 본문.pdf"
OUT = Path(__file__).resolve().parent / "paper_pages.py"
HDR = re.compile(r"BOK-LOOK: A Semi-Structural Model[^\n]*?(\d{1,3})\s*\n"
                 r"|(\d{1,3})\s+BOK Working Paper No\. 2025-3")


def scan() -> dict:
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(PDF))
    out: dict[int, set] = {}
    for i in range(len(pdf)):
        t = pdf[i].get_textpage().get_text_range()
        hdrs = [(m.start(), int(m.group(1) or m.group(2)))
                for m in HDR.finditer(t)]
        if not hdrs:
            continue
        for m in re.finditer(r"\((\d{1,2})\)\s*\n", t):
            n = int(m.group(1))
            if not 1 <= n <= 44:
                continue
            c = [pg for off, pg in hdrs if off <= m.start()]
            out.setdefault(n, set()).add(c[-1] if c else hdrs[0][1])
    return out


if __name__ == "__main__":
    loc = scan()
    missing = [n for n in range(1, 45) if len(loc.get(n, [])) != 1]
    print(f"{len(loc)}/44 찾음, 애매한 것 {missing}")
