"""
프로젝트의 기간 읽기 (0.13.0) — 직접 구현

계획을 세울 때는 날짜가 딱 정해지지 않은 경우가 많아서, 정확한 날짜뿐 아니라 '대략'도 받는다.

    "~12/6", "12/6까지"            → 오늘 ~ 12/6            (정확한 날짜)
    "11/20~12/6", "11월 20일~12월 6일" → 11/20 ~ 12/6
    "1월 중", "1월"                → 1/1 ~ 1/31            (대략: '1월 중')
    "~1월", "1월까지"              → 오늘 ~ 1/31           (대략: '~1월')
    "1~2월"                        → 1/1 ~ 2/28           (대략: '1~2월')
    "겨울방학", "여름방학"          → 12/21 ~ 2월 말, 6/21 ~ 8/31
    "1학기", "2학기"               → 3/1 ~ 6/20, 9/1 ~ 12/20
    "상반기", "하반기", "1분기"…   → 그 반년·석 달
    "봄", "여름", "가을", "겨울"    → 3~5월, 6~8월, 9~11월, 12~2월
    "올해", "내년", "연말", "이번 달", "다음 달"
    앞에 "2027(년)"을 붙이면 그 해. 안 붙이면 아직 끝나지 않은 가장 가까운 것 (11월에 '1학기' → 내년 1학기)

대략으로 쓴 기간은 화면에 쓴 그대로('1월 중') 보이고, 타임라인에는 위의 날짜로 그린다.
"""

import re
from calendar import monthrange
from datetime import date as Date
from datetime import timedelta

B = r"(?<![^\s,(\[~])"
E = r"(?=$|[\s,.!?)\]~])"

YEAR = r"(?:(?P<y>\d{4})\s*년?\s*)?"
MD = r"(?:(?P<{p}y>\d{{4}})[-./])?(?P<{p}m>\d{{1,2}})(?:[/.]|월\s*)(?P<{p}d>\d{{1,2}})일?"

EXACT_RE = re.compile(
    B + r"(?:" + MD.format(p="a") + r")?\s*(?:부터)?\s*[~\-–]\s*" + MD.format(p="b") + r"\s*(?:까지)?" + E
    + r"|" + B + MD.format(p="c") + r"\s*까지" + E
)
MONTHS_RE = re.compile(B + YEAR + r"(?P<m1>\d{1,2})\s*(?:월\s*)?[~\-–]\s*(?P<m2>\d{1,2})\s*월\s*(?:중|안에|까지)?" + E)
UNTIL_MONTH_RE = re.compile(B + r"(?:~\s*" + YEAR + r"(?P<m>\d{1,2})\s*월|" + YEAR.replace("P<y>", "P<y2>") + r"(?P<m2>\d{1,2})\s*월\s*까지)" + E)
MONTH_RE = re.compile(B + YEAR + r"(?P<m>\d{1,2})\s*월\s*(?:중|안에|내내|동안)?" + E)
NAMED_RE = re.compile(
    B + YEAR + r"(?P<name>겨울\s*방학|여름\s*방학|[12]\s*학기|상반기|하반기|[1-4]\s*분기|봄|여름|가을|겨울|연말)"
    r"\s*(?:중|동안|내내|까지|안에)?" + E
    + r"|" + B + r"(?P<rel>올해|금년|내년|이번\s*달|다음\s*달)\s*(?:중|안에|까지|동안)?" + E
)


def _end_of_month(y, m):
    return Date(y, m, monthrange(y, m)[1])


def _named_span(name, y):
    """이름 붙은 기간 → (시작, 끝). 겨울·겨울방학은 그 해 12월에 시작해서 다음 해로 넘어간다."""
    name = re.sub(r"\s+", "", name)
    if name == "겨울방학":
        return Date(y, 12, 21), _end_of_month(y + 1, 2)
    if name == "여름방학":
        return Date(y, 6, 21), Date(y, 8, 31)
    if name == "1학기":
        return Date(y, 3, 1), Date(y, 6, 20)
    if name == "2학기":
        return Date(y, 9, 1), Date(y, 12, 20)
    if name == "상반기":
        return Date(y, 1, 1), Date(y, 6, 30)
    if name == "하반기":
        return Date(y, 7, 1), Date(y, 12, 31)
    if name.endswith("분기"):
        q = int(name[0])
        return Date(y, 3 * q - 2, 1), _end_of_month(y, 3 * q)
    if name == "봄":
        return Date(y, 3, 1), Date(y, 5, 31)
    if name == "여름":
        return Date(y, 6, 1), Date(y, 8, 31)
    if name == "가을":
        return Date(y, 9, 1), Date(y, 11, 30)
    if name == "겨울":
        return Date(y, 12, 1), _end_of_month(y + 1, 2)
    return Date(y, 12, 1), Date(y, 12, 31)  # 연말


def _upcoming(make, today, year):
    """해를 안 썼으면 아직 끝나지 않은 가장 가까운 것 (작년 겨울방학이 아직 안 끝났으면 그것)"""
    if year:
        return make(year)
    for y in (today.year - 1, today.year, today.year + 1):
        start, end = make(y)
        if end >= today:
            return start, end
    return make(today.year + 1)


def _safe(y, m, d):
    try:
        return Date(y, m, d)
    except ValueError:
        return None


def _md(m, p, today, after=None):
    """정확한 날짜 하나. 해를 안 썼으면 기준 날짜(after 또는 오늘)보다 뒤인 가장 가까운 것"""
    month, day = int(m.group(f"{p}m")), int(m.group(f"{p}d"))
    if m.group(f"{p}y"):
        return _safe(int(m.group(f"{p}y")), month, day)
    base = after or today
    d = _safe(base.year, month, day)
    if d and d < base - timedelta(days=60):   # 이미 한참 지난 날짜면 내년으로
        d = _safe(base.year + 1, month, day)
    return d


def parse_period(text, today):
    """
    글에서 기간을 찾는다 → {start, end, label, span: (시작 위치, 끝 위치)} 또는 None
      start, end : 'YYYY-MM-DD' (end 포함)
      label      : 대략으로 쓴 기간이면 쓴 그대로 ('1월 중'), 정확한 날짜면 ''
    """
    text = re.sub(r"(\d{4})-(\d{1,2})-(\d{1,2})", r"\1/\2/\3", text or "")  # 2026-12-01 → 2026/12/01 (글자 수는 그대로)

    m = EXACT_RE.search(text)
    if m:
        if m.group("cm"):
            end = _md(m, "c", today)
            start = today if end and end >= today else end
        else:
            start = _md(m, "a", today) if m.group("am") else today
            end = _md(m, "b", today, after=start if m.group("am") else None)
            if start and end and end < start and not m.group("by"):
                end = _safe(end.year + 1, end.month, end.day)
        if start and end and end >= start:
            return _found(m, start, end, "")

    m = MONTHS_RE.search(text)
    if m:
        m1, m2 = int(m.group("m1")), int(m.group("m2"))
        if 1 <= m1 <= 12 and 1 <= m2 <= 12:
            year = int(m.group("y")) if m.group("y") else None

            def make(y, m1=m1, m2=m2):
                return Date(y, m1, 1), _end_of_month(y if m2 >= m1 else y + 1, m2)
            start, end = _upcoming(make, today, year)
            return _found(m, start, end, _label(m.group(0)))

    m = UNTIL_MONTH_RE.search(text)
    if m:
        month = int(m.group("m") or m.group("m2"))
        year = m.group("y") or m.group("y2")
        if 1 <= month <= 12:
            if year:
                end = _end_of_month(int(year), month)
            else:
                end = _end_of_month(today.year, month)
                if end < today:
                    end = _end_of_month(today.year + 1, month)
            return _found(m, today, max(end, today), f"~{month}월")

    m = NAMED_RE.search(text)
    if m:
        year = int(m.group("y")) if m.group("y") else None
        if m.group("rel"):
            rel = re.sub(r"\s+", "", m.group("rel"))
            if rel in ("올해", "금년"):
                start, end = today, Date(today.year, 12, 31)
            elif rel == "내년":
                start, end = Date(today.year + 1, 1, 1), Date(today.year + 1, 12, 31)
            elif rel == "이번달":
                start, end = today, _end_of_month(today.year, today.month)
            else:  # 다음 달
                first = (Date(today.year, today.month, 28) + timedelta(days=4)).replace(day=1)
                start, end = first, _end_of_month(first.year, first.month)
            return _found(m, start, end, _label(m.group(0)), named=True)
        start, end = _upcoming(lambda y: _named_span(m.group("name"), y), today, year)
        return _found(m, start, end, _label(m.group(0)), named=True)

    m = MONTH_RE.search(text)
    if m:
        month = int(m.group("m"))
        if 1 <= month <= 12:
            year = int(m.group("y")) if m.group("y") else None
            start, end = _upcoming(lambda y: (Date(y, month, 1), _end_of_month(y, month)), today, year)
            label = _label(m.group(0))
            if not label.endswith(("중", "안에", "내내", "동안")):
                label += " 중"
            return _found(m, start, end, label)
    return None


def _label(raw):
    return re.sub(r"\s+", " ", raw.strip())


def _found(m, start, end, label, named=False):
    return {"start": start.isoformat(), "end": end.isoformat(), "label": label, "span": (m.start(), m.end()), "named": named}


def split_title(text, today):
    """
    '텀프로젝트 ~12/6' → ('텀프로젝트', 기간). 기간이 없으면 (글 그대로, None)
    '겨울방학 계획', '내년 여행'처럼 이름 붙은 기간으로 시작하면 그 말도 제목의 일부라서 제목에 남긴다.
    """
    text = text or ""
    found = parse_period(text, today)
    if not found:
        return text.strip(), None
    s, e = found["span"]
    if found.pop("named") and not text[:s].strip() and text[e:].strip():
        return text.strip(), found
    title = re.sub(r"\s+", " ", (text[:s] + " " + text[e:])).strip(" ,·-")
    return title, found
