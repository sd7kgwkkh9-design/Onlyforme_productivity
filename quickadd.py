"""
빠른 입력 — 한 줄로 쓴 일정을 해석한다 (직접 구현).

    "내일 3시~5시 스터디 #과제"   → 내일, 15:00~17:00, 카테고리 '과제', 제목 '스터디'
    "금요일까지 레포트 !"         → 이번 금요일, D-day 표시, 제목 '레포트'
    "다음 주 월요일 9시 반 회의"  → 다음 주 월요일, 09:30, 제목 '회의'
    "언젠가 책 정리"              → 기한 미정, 제목 '책 정리'

규칙 (빠른 입력 창의 도움말, README에도 같은 내용)
  날짜   오늘·내일·모레·글피·어제, 3일 뒤, 2주 후, (이번 주 / 다음 주) 금요일,
         11/20, 11월 20일, 2026-11-20, 20일, 기간 11/20~11/22, 여러 개 쓰면 여러 날짜
         → 날짜를 안 쓰면 기준 날짜(보통 오늘). 언젠가 / 기한 미정 → 기한 미정
  시간   3시, 3시 반, 3시 30분, 15:30, 오전·오후·아침·저녁·밤·새벽, 정오
         3시~5시, 3시부터 5시까지 → 시작~끝,   6시까지 / ~6시 → 끝만
         오전·오후를 안 쓰면 1~7시는 오후로 본다 (7시 스터디 → 19:00, 9시 수업 → 09:00)
  기타   #카테고리,  띄어 쓴 ! 또는 'D-day' → D-day 표시

해석은 '찾은 부분을 지워 나가는' 방식이다.
카테고리·D-day → 날짜 → 시간 순서로 찾고, 찾은 글자는 같은 길이의 공백으로 덮는다
(그래야 다음 단계가 같은 글자를 두 번 쓰지 않고, 화면에 '어디를 무엇으로 읽었는지' 위치를 그대로 알려 줄 수 있다).
남은 글자가 제목이 된다.
"""

import re
from calendar import monthrange
from datetime import date as Date
from datetime import timedelta

MAX_RANGE_DAYS = 62   # 기간으로 한 번에 넣을 수 있는 날짜 수
MAX_TITLE = 100

# 앞뒤 경계: 낱말 중간(예: '금요일' 안의 '일')을 잘못 읽지 않도록.
#   B: 글 처음이거나 앞 글자가 공백·쉼표·괄호·물결
#   E: 글 끝이거나 뒤 글자가 공백·문장부호·물결
B = r"(?<![^\s,(\[~])"
E = r"(?=$|[\s,.!?)\]~])"

# 날짜·시간 뒤에 붙는 조사 ('내일까지', '3시에', '금요일의')
DATE_TAIL = r"(?:에는|에|엔|까지|부터|의|은|는|날)?"

WEEKDAYS = "월화수목금토일"  # date.weekday(): 월=0 … 일=6
WEEK_OFFSET = {"이번주": 0, "금주": 0, "다음주": 1, "담주": 1, "차주": 1, "다다음주": 2, "저번주": -1, "지난주": -1}
DAY_WORDS = {"오늘": 0, "금일": 0, "내일": 1, "낼": 1, "명일": 1, "모레": 2, "내일모레": 2, "글피": 3, "어제": -1, "그제": -2, "그저께": -2}

DATE_RE = re.compile(
    B + r"(?:"
    r"(?P<iy>\d{4})[-./](?P<im>\d{1,2})[-./](?P<id>\d{1,2})"                       # 2026-11-20
    r"|(?:(?P<ky>\d{4})년\s*)?(?P<km>\d{1,2})월\s*(?P<kd>\d{1,2})일"                # (2026년) 11월 20일
    r"|(?P<sm>\d{1,2})[/.](?P<sd>\d{1,2})(?![\d:/.])"                              # 11/20, 11.20
    r"|(?P<rn>\d{1,3})\s*(?P<ru>일|주일|주|달|개월)\s*(?:뒤|후)"                          # 3일 뒤, 2주 후
    r"|다음\s*달\s*(?P<nd>\d{1,2})일"                                               # 다음 달 3일
    r"|(?:(?P<wq>이번\s*주|금주|다음\s*주|담주|차주|다다음\s*주|저번\s*주|지난\s*주)\s*)?(?P<wd>[월화수목금토일])요일"
    r"|(?P<wq2>이번\s*주|다음\s*주|담주|다다음\s*주)\s*(?P<wd2>[월화수목금토일])(?![가-힣])"  # 다음 주 금
    r"|(?P<word>내일\s*모레|오늘|금일|내일|낼|명일|모레|글피|어제|그저께|그제)"
    r"|(?P<bd>\d{1,2})일"                                                           # 20일
    r")" + DATE_TAIL + E
)

# 기간의 뒷부분이 '22'처럼 숫자만 있는 경우 (11/20~22)
RANGE_TAIL_RE = re.compile(r"\s*[~\-–]\s*(?P<day>\d{1,2})(?:일)?" + DATE_TAIL + E)
RANGE_SEP_RE = re.compile(r"^\s*[~\-–]\s*$")


def _time_part(p):
    """시각 하나: [오전|오후|…] 3시 (반 | 30분) | 15:30 | 정오. 그룹 이름 앞에 p를 붙인다."""
    return (
        rf"(?:(?P<{p}mer>오전|오후|아침|낮|점심|저녁|밤|새벽)\s*)?"
        rf"(?:(?P<{p}h>\d{{1,2}})\s*시(?:\s*(?P<{p}half>반)|\s*(?P<{p}m>\d{{1,2}})\s*분)?"
        rf"|(?P<{p}hh>\d{{1,2}}):(?P<{p}mm>\d{{2}})"
        rf"|(?P<{p}noon>정오))"
    )


TIME_RE = re.compile(
    B + r"(?P<tilde>~\s*)?" + _time_part("a")
    + r"(?:\s*(?:~|-|–|부터)\s*" + _time_part("b") + r")?"
    + r"\s*(?P<tail>까지|부터|에|쯤|경|~)?" + E
)

TAG_RE = re.compile(r"(?<!\S)#(?P<tag>[^\s#]+)")
DDAY_RE = re.compile(r"(?<!\S)(?:!|D-?day|디데이)(?!\S)", re.IGNORECASE)
UNDATED_RE = re.compile(r"(?<!\S)(?:언젠가|기한\s*미정|날짜\s*미정)(?!\S)")


class _Text:
    """원래 글과, 찾은 부분을 공백으로 덮어 가는 작업용 글."""

    def __init__(self, text):
        self.original = text
        self.work = text
        self.spans = []  # [{'start', 'end', 'kind'}] — 화면에서 색으로 표시

    def take(self, start, end, kind):
        self.work = self.work[:start] + " " * (end - start) + self.work[end:]
        self.spans.append({"start": start, "end": end, "kind": kind})


# ---------------------------------------------------------------- 날짜 계산
def _add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return Date(y, m, min(d.day, monthrange(y, m)[1]))


def _safe_date(y, m, d):
    try:
        return Date(y, m, d)
    except ValueError:
        return None


def _month_day(today, m, d, year=None):
    """연도 없이 쓴 '11/20': 올해로 보되, 두 달 넘게 지난 날짜면 내년으로 (12월에 '1/15'를 쓰는 경우)."""
    if year:
        return _safe_date(int(year), m, d)
    cand = _safe_date(today.year, m, d)
    if cand and cand < today - timedelta(days=60):
        cand = _safe_date(today.year + 1, m, d)
    return cand


def _date_from_match(m, today):
    g = m.groupdict()
    if g["iy"]:
        return _safe_date(int(g["iy"]), int(g["im"]), int(g["id"]))
    if g["km"]:
        return _month_day(today, int(g["km"]), int(g["kd"]), g["ky"])
    if g["sm"]:
        return _month_day(today, int(g["sm"]), int(g["sd"]))
    if g["rn"]:
        n = int(g["rn"])
        unit = g["ru"]
        if unit == "일":
            return today + timedelta(days=n)
        if unit in ("주", "주일"):
            return today + timedelta(weeks=n)
        return _add_months(today, n)
    if g["nd"]:
        nxt = _add_months(today.replace(day=1), 1)
        return _safe_date(nxt.year, nxt.month, int(g["nd"]))
    if g["wd"] or g["wd2"]:
        wd = WEEKDAYS.index(g["wd"] or g["wd2"])
        q = (g["wq"] or g["wq2"] or "").replace(" ", "")
        if q:
            # '이번 주/다음 주'는 월요일부터 시작하는 주로 본다 ('이번 주 일요일' = 다가오는 일요일)
            monday = today - timedelta(days=today.weekday())
            return monday + timedelta(weeks=WEEK_OFFSET[q], days=wd)
        return today + timedelta(days=(wd - today.weekday()) % 7)  # 그냥 '금요일' = 오늘부터 가장 가까운 금요일
    if g["word"]:
        return today + timedelta(days=DAY_WORDS[g["word"].replace(" ", "")])
    if g["bd"]:
        cand = _safe_date(today.year, today.month, int(g["bd"]))
        if cand and cand < today:  # 이미 지난 날이면 다음 달
            nxt = _add_months(today.replace(day=1), 1)
            cand = _safe_date(nxt.year, nxt.month, int(g["bd"]))
        return cand
    return None


def _find_dates(t, today, warnings):
    matches = list(DATE_RE.finditer(t.work))
    found = []  # [(start, end, [dates])]
    i = 0
    while i < len(matches):
        m = matches[i]
        first = _date_from_match(m, today)
        if first is None:
            warnings.append(f"'{m.group(0).strip()}'은(는) 없는 날짜예요.")
            i += 1
            continue

        end_pos, last = m.end(), None
        # 기간: [날짜] ~ [날짜]
        nxt = matches[i + 1] if i + 1 < len(matches) else None
        if nxt and RANGE_SEP_RE.match(t.work[m.end():nxt.start()]):
            last = _date_from_match(nxt, today)
            if last and nxt.group("bd") and m.group("bd") is None:
                # '11월 20일~22일': 뒤쪽은 앞쪽과 같은 달
                last = _safe_date(first.year, first.month, int(nxt.group("bd")))
            if last:
                end_pos = nxt.end()
                i += 1
        else:
            tail = RANGE_TAIL_RE.match(t.work, m.end())
            if tail:
                last = _safe_date(first.year, first.month, int(tail.group("day")))
                if last:
                    end_pos = tail.end()

        if last and last < first:
            first, last = last, first
        if last and (last - first).days >= MAX_RANGE_DAYS:
            warnings.append(f"기간은 {MAX_RANGE_DAYS}일까지만 넣을 수 있어요.")
            last = first + timedelta(days=MAX_RANGE_DAYS - 1)
        days = [first] if not last else [first + timedelta(days=k) for k in range((last - first).days + 1)]
        found.append((m.start(), end_pos, days))
        i += 1

    dates = []
    for start, end, days in found:
        t.take(start, end, "date")
        dates.extend(days)
    return sorted({d.isoformat() for d in dates})


# ---------------------------------------------------------------- 시간 계산
def _clock(g, p):
    """(시, 분, 오전·오후를 직접 썼는지/24시간으로 썼는지) 또는 None"""
    mer = g[f"{p}mer"]
    if g[f"{p}noon"]:
        return 12, 0, True
    if g[f"{p}hh"]:
        h, minute = int(g[f"{p}hh"]), int(g[f"{p}mm"])
        literal = g[f"{p}hh"].startswith("0") or h >= 13 or h == 0  # 07:00, 15:30 은 쓴 그대로
    else:
        h = int(g[f"{p}h"])
        minute = 30 if g[f"{p}half"] else int(g[f"{p}m"] or 0)
        literal = h >= 13 or h == 0
    if not (0 <= h <= 24 and 0 <= minute <= 59):
        return None
    if h == 24:
        h = 0

    if mer in ("오전", "아침", "새벽"):
        h = 0 if h == 12 else h
        return h, minute, True
    if mer == "밤":
        h = 0 if h == 12 else h if h <= 4 else h + 12 if h < 12 else h  # 밤 1시 = 01시, 밤 11시 = 23시
        return h, minute, True
    if mer in ("오후", "낮", "점심", "저녁"):
        return (h + 12 if h < 12 else h), minute, True
    if literal:
        return h, minute, True
    # 오전·오후를 안 썼을 때: 1~7시는 오후, 8~12시는 그대로
    return (h + 12 if 1 <= h <= 7 else h), minute, False


def _fmt(h, minute):
    return f"{h:02d}:{minute:02d}"


def _find_time(t, warnings):
    for m in TIME_RE.finditer(t.work):
        g = m.groupdict()
        a = _clock(g, "a")
        if a is None:
            continue
        b = _clock(g, "b") if (g["bh"] or g["bhh"] or g["bnoon"]) else None
        start = end = None
        if b:
            start, end = a, b
            if not end[2] and end[0] * 60 + end[1] <= start[0] * 60 + start[1] and end[0] + 12 < 24:
                end = (end[0] + 12, end[1], False)  # '저녁 8시~10시' → 20:00~22:00
        elif g["tilde"] or g["tail"] == "까지":
            end = a
        else:
            start = a

        t.take(m.start(), m.end(), "time")
        start_s = _fmt(*start[:2]) if start else None
        end_s = _fmt(*end[:2]) if end else None
        if start_s and end_s and end_s <= start_s:
            warnings.append("끝 시간이 시작 시간보다 빨라서 시작 시간만 넣었어요.")
            end_s = None
        return start_s, end_s  # 시간은 하나만 쓴다 (첫 번째)
    return None, None


# ---------------------------------------------------------------- 전체
def _clean_title(work):
    title = re.sub(r"\s+", " ", work).strip(" ,~·-–/")
    return title[:MAX_TITLE]


def _match_category(tag, categories):
    """#태그 → 카테고리. 이름이 똑같은 것 → 대소문자 무시 → 앞부분이 같은 것이 하나뿐일 때."""
    low = tag.lower()
    for c in categories:
        if c["name"] == tag:
            return c
    for c in categories:
        if c["name"].lower() == low:
            return c
    starts = [c for c in categories if c["name"].lower().startswith(low)]
    return starts[0] if len(starts) == 1 else None


def parse(text, today, categories=(), routines=(), default_date=None):
    """
    text        사용자가 쓴 한 줄
    today       기준이 되는 '오늘' (date). 서버 시계 대신 화면(기기)의 날짜를 받는다
                — 인터넷 서버는 보통 영국 시간(UTC)이라 한국과 날짜가 다를 수 있기 때문.
    categories  [{'id', 'name', 'color'}]   #태그를 찾을 대상
    routines    [{'id', 'name', 'category_id'}]  제목이 루틴 이름과 같으면 그 루틴으로 연결
    default_date 날짜를 안 썼을 때 넣을 날짜 (없으면 today)
    """
    text = (text or "").strip()
    t = _Text(text)
    warnings = []

    # 1) 카테고리 (#과제) — 첫 번째 것만 쓰고, 나머지 #태그도 제목에서는 지운다
    category, unknown_tag = None, None
    for m in TAG_RE.finditer(t.work):
        if category is None and unknown_tag is None:
            category = _match_category(m.group("tag"), categories)
            if category is None:
                unknown_tag = m.group("tag")
        t.take(m.start(), m.end(), "category")
    if unknown_tag:
        warnings.append(f"'{unknown_tag}' 카테고리가 없어서 미분류로 넣어요.")

    # 2) D-day, 기한 미정
    dday = False
    for m in DDAY_RE.finditer(t.work):
        dday = True
        t.take(m.start(), m.end(), "dday")
    undated = False
    for m in UNDATED_RE.finditer(t.work):
        undated = True
        t.take(m.start(), m.end(), "undated")

    # 3) 날짜 → 4) 시간
    dates = _find_dates(t, today, warnings)
    start_time, end_time = _find_time(t, warnings)

    date_defaulted = False
    if undated:
        dates = []
    elif not dates:
        dates = [(default_date or today).isoformat()]
        date_defaulted = True

    title = _clean_title(t.work)

    # 5) 루틴: 제목이 루틴 이름과 같으면 연결 (카테고리를 따로 안 썼으면 루틴의 카테고리)
    routine_id = None
    for r in routines:
        if title and r["name"].strip().lower() == title.lower():
            routine_id = r["id"]
            if category is None and unknown_tag is None:
                category = next((c for c in categories if c["id"] == r["category_id"]), None)
            break

    if dday and not dates:
        warnings.append("기한 미정 일정은 D-day가 보이지 않아요.")

    return {
        "title": title,
        "dates": dates,
        "date_defaulted": date_defaulted,
        "undated": undated,
        "start_time": start_time,
        "end_time": end_time,
        "category": {"id": category["id"], "name": category["name"], "color": category["color"]} if category else None,
        "unknown_tag": unknown_tag,
        "routine_id": routine_id,
        "dday": dday,
        "spans": sorted(t.spans, key=lambda s: s["start"]),
        "warnings": warnings,
    }
