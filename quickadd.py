"""
빠른 입력 — 한 줄로 쓴 일정을 해석한다 (직접 구현).

    "내일 3시~5시 스터디 #과제"   → 내일, 15:00~17:00, 카테고리 '과제', 제목 '스터디'
    "금요일까지 레포트 !"         → 이번 금요일, D-day 표시, 제목 '레포트'
    "다음 주 월요일 9시 반 회의"  → 다음 주 월요일, 09:30, 제목 '회의'
    "언젠가 책 정리"              → 할 일(날짜 없음), 제목 '책 정리'
    "매주 월수 9시 컴구 ~12/15"   → 오늘부터 12/15까지의 월·수 전부 (반복 일정, 0.9.0)
    "- 블로그 주제: 해저드"       → 기록지의 메모 (0.9.0)
    "* 12월까지 풀업 15개"        → 기록지의 목표, 기한 12/31 (0.9.0)

규칙 (빠른 입력 창의 도움말, README에도 같은 내용)
  날짜   오늘·내일·모레·글피·어제, 3일 뒤, 2주 후, (이번 주 / 다음 주) 금요일,
         11/20, 11월 20일, 2026-11-20, 20일, 기간 11/20~11/22, 여러 개 쓰면 여러 날짜
         → 날짜를 안 쓰면 할 일(기록지, 0.8까지의 '기한 미정') — '언젠가'라고 써도 같다
  반복   매주 월수, 격주 화, 매일, 매주 평일/주말, 화요일마다 (0.9.0)
         시작은 쓴 날짜(11/10부터) 또는 오늘, 끝은 ~12/15 / 12/15까지 / 기간 11/10~12/15
         끝을 안 쓰면 시작 날짜가 있는 달의 말일까지만 넣는다
  시간   3시, 3시 반, 3시 30분, 15:30, 오전·오후·아침·저녁·밤·새벽, 정오
         3시~5시, 3시부터 5시까지 → 시작~끝,   6시까지 / ~6시 → 끝만
         오전·오후를 안 쓰면 1~7시는 오후로 본다 (7시 스터디 → 19:00, 9시 수업 → 09:00)
  기타   #카테고리,  띄어 쓴 ! 또는 'D-day' → D-day 표시
  루틴   제목이 루틴 이름과 같으면 ('운동 7시') 일정이 아니라 루틴 기록으로 — 날짜를 안 쓰면 오늘
  종류   맨 앞에  -  메모   *  목표 (기한: 12월까지, 이번 달 안에, 12/20까지 …)   [ ]  할 일

해석은 '찾은 부분을 지워 나가는' 방식이다.
카테고리·D-day → 반복 → 날짜 → 시간 순서로 찾고, 찾은 글자는 같은 길이의 공백으로 덮는다
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

# ---- 반복 (0.9.0): 매주 월수 / 격주 화 / 매일 / 매주 평일 / 화요일마다
# 요일 글자는 바로 뒤가 요일·구분 기호·숫자·끝일 때만 요일로 본다 → '매주 화 수업'의 '수'(수업)는 요일이 아니다
_WD_LIST = r"(?:[월화수목금토일](?:요일)?(?=[월화수목금토일\s,·/]|마다|$|[^가-힣])[\s,·/]*)+"
REPEAT_RE = re.compile(
    B + r"(?:"
    r"(?P<every>매주|격주|2주마다|두\s*주마다)(?:\s*(?P<days>평일|주말|" + _WD_LIST + r")(?:마다)?)?"
    r"|(?P<daily>매일)"
    r"|(?P<wk>평일|주말)\s*마다"
    r"|(?P<days2>" + _WD_LIST + r")마다"
    r")(?=$|[\s,.!?)\]~]|\d)"
)
MAX_REPEAT_DAYS = 366

# ---- 종류 (0.9.0): 맨 앞의 기호로 메모·목표·할 일을 고른다
PREFIX_RE = re.compile(r"^\s*(?:(?P<memo>-)(?=\s|$)|(?P<goal>\*)(?=\s|$)|(?P<todo>\[\s*\]))")

# ---- 목표의 기한: '12월까지', '이번 달 안에', '올해 안에' → 그 달(해)의 마지막 날
_GOAL_TAIL = r"\s*(?:말|안|중|내)?\s*(?:에|까지|안에|중에|내에|이내)?"
GOAL_DUE_RE = re.compile(
    B + r"(?:"
    r"(?P<gm>\d{1,2})월"
    r"|(?P<gthis>이번\s*달|이달|금월)"
    r"|(?P<gnext>다음\s*달|담달|내달)"
    r"|(?P<gyear>올해|금년|연말)"
    r"|(?P<gnyear>내년)"
    r")" + _GOAL_TAIL + E
)


class _Text:
    """원래 글과, 찾은 부분을 공백으로 덮어 가는 작업용 글."""

    def __init__(self, text):
        self.original = text
        self.work = text
        self.spans = []     # [{'start', 'end', 'kind'}] — 화면에서 색으로 표시
        self.segments = []  # 찾은 날짜 덩어리 [{first, last, until}] (반복 일정의 시작·끝 정하기용)

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
        # '~12/15', '12/15까지' → 끝 날짜라는 표시 (반복 일정의 끝을 정할 때 쓴다)
        until = t.work[:m.start()].rstrip().endswith("~") or t.work[m.start():end_pos].rstrip().endswith("까지")
        found.append((m.start(), end_pos, days, {"first": first, "last": last, "until": until}))
        i += 1

    dates = []
    for start, end, days, _seg in found:
        t.take(start, end, "date")
        dates.extend(days)
    t.segments = [seg for *_rest, seg in found]
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

        # 뒤쪽 \s*가 이미 지운(공백으로 덮은) #태그·! 자리까지 먹지 않도록 끝의 공백은 빼고 표시한다
        t.take(m.start(), m.start() + len(m.group(0).rstrip()), "time")
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


# ---------------------------------------------------------------- 반복 (0.9.0)
def _month_end(d):
    return d.replace(day=monthrange(d.year, d.month)[1])


def _weekday_set(word):
    if word in ("평일",):
        return {0, 1, 2, 3, 4}
    if word in ("주말",):
        return {5, 6}
    return {WEEKDAYS.index(ch) for ch in re.sub(r"요일", "", word) if ch in WEEKDAYS}


def repeat_dates(start, end, weekdays, interval=1):
    """
    start~end(포함) 중 요일이 weekdays(월=0 … 일=6)인 날짜들.
    interval=2(격주)면 첫 번째로 해당하는 날이 있는 주부터 한 주씩 건너뛴다 (주는 월요일 시작).
    """
    days = []
    d = start
    while d <= end:
        if d.weekday() in weekdays:
            days.append(d)
        d += timedelta(days=1)
    if interval == 2 and days:
        week0 = days[0] - timedelta(days=days[0].weekday())
        days = [x for x in days if ((x - timedelta(days=x.weekday()) - week0).days // 7) % 2 == 0]
    return days


def _find_repeat(t):
    """반복 표현을 찾아 {'interval', 'weekdays'(없으면 None), 'daily'}를 돌려준다. 없으면 None."""
    m = REPEAT_RE.search(t.work)
    if not m:
        return None
    g = m.groupdict()
    if g["daily"]:
        rule = {"interval": 1, "weekdays": set(range(7)), "daily": True}
    elif g["every"]:
        interval = 1 if g["every"] == "매주" else 2
        rule = {"interval": interval, "weekdays": _weekday_set(g["days"]) if g["days"] else None, "daily": False}
    else:
        rule = {"interval": 1, "weekdays": _weekday_set(g["wk"] or g["days2"]), "daily": False}
    t.take(m.start(), m.start() + len(m.group(0).rstrip(" ,·/")), "repeat")
    return rule


def _apply_repeat(rule, t, today, warnings):
    """찾은 날짜 덩어리로 시작·끝을 정하고, 반복되는 날짜 목록을 만든다."""
    segs = t.segments
    start, end, end_default = today, None, False
    points = [p for s in segs for p in (s["first"], s["last"]) if p]
    if len(segs) >= 2 or any(s["last"] for s in segs):
        start, end = min(points), max(points)        # '11/10~12/15', '11/10부터 12/15까지'
    elif segs:
        if segs[0]["until"]:
            end = segs[0]["first"]                   # '~12/15', '12/15까지' → 오늘부터
        else:
            start = segs[0]["first"]                 # '11/10' → 그날부터
    if end is None:
        end = _month_end(start)                      # 끝을 안 쓰면 그 달 말일까지만
        end_default = True
    if end < start:
        warnings.append("끝 날짜가 시작 날짜보다 빨라요. 반복할 기간을 다시 적어 주세요.")
        return [], None
    if (end - start).days >= MAX_REPEAT_DAYS:
        end = start + timedelta(days=MAX_REPEAT_DAYS - 1)
        warnings.append("반복은 1년까지만 넣을 수 있어요.")
    weekdays = rule["weekdays"] or {start.weekday()}  # '매주 3시 회의' → 시작하는 날의 요일
    days = repeat_dates(start, end, weekdays, rule["interval"])
    if not days:
        warnings.append("그 기간에는 반복할 요일이 없어요.")
    if end_default and days:
        warnings.append(f"끝 날짜를 안 써서 {end.month}/{end.day}까지만 넣어요. (~12/15처럼 끝을 쓸 수 있어요)")
    info = {
        "interval": rule["interval"],
        "daily": rule["daily"],
        "weekdays": sorted(weekdays),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "end_default": end_default,
        "count": len(days),
    }
    return [d.isoformat() for d in days], info


# ---------------------------------------------------------------- 목표의 기한 (0.9.0)
def _goal_due(t, today, warnings):
    """목표: 쓴 날짜 중 가장 늦은 날, 또는 '12월까지'·'이번 달 안에' 같은 말 → 그 달의 마지막 날"""
    dates = _find_dates(t, today, warnings)
    candidates = [Date.fromisoformat(d) for d in dates]
    for m in GOAL_DUE_RE.finditer(t.work):
        g = m.groupdict()
        if g["gm"]:
            month = int(g["gm"])
            if not 1 <= month <= 12:
                continue
            year = today.year + (1 if month < today.month else 0)  # 11월에 '3월까지' → 내년 3월
            candidates.append(_month_end(Date(year, month, 1)))
        elif g["gthis"]:
            candidates.append(_month_end(today))
        elif g["gnext"]:
            candidates.append(_month_end(_add_months(today.replace(day=1), 1)))
        elif g["gyear"]:
            candidates.append(Date(today.year, 12, 31))
        else:
            candidates.append(Date(today.year + 1, 12, 31))
        t.take(m.start(), m.start() + len(m.group(0).rstrip()), "date")
    return max(candidates).isoformat() if candidates else None


# ---------------------------------------------------------------- 전체
def _result(t, warnings, kind, title, **extra):
    base = {
        "kind": kind,            # 'schedule'(날짜 있는 일정) | 'todo'(날짜 없는 일정 = 할 일) | 'routine' | 'memo' | 'goal'
        "title": title,
        "dates": [],
        "undated": False,
        "start_time": None,
        "end_time": None,
        "category": None,
        "unknown_tag": None,
        "routine": None,
        "routine_today": False,
        "dday": False,
        "repeat": None,          # 반복이면 {interval, daily, weekdays, start, end, end_default, count}
        "due": None,             # 목표의 기한
        "spans": sorted(t.spans, key=lambda s: s["start"]),
        "warnings": warnings,
    }
    base.update(extra)
    return base


def parse(text, today, categories=(), routines=()):
    """
    text        사용자가 쓴 한 줄
    today       기준이 되는 '오늘' (date). 서버 시계 대신 화면(기기)의 날짜를 받는다
                — 인터넷 서버는 보통 영국 시간(UTC)이라 한국과 날짜가 다를 수 있기 때문.
    categories  [{'id', 'name', 'color'}]   #태그를 찾을 대상
    routines    [{'id', 'name', 'emoji'}]   제목이 루틴 이름과 같으면 루틴 기록으로
    """
    text = (text or "").strip()
    t = _Text(text)
    warnings = []

    # 0) 맨 앞 기호: - 메모, * 목표, [ ] 할 일 (0.9.0)
    prefix = None
    m = PREFIX_RE.match(t.work)
    if m:
        prefix = next(k for k in ("memo", "goal", "todo") if m.group(k))
        t.take(m.start(prefix), m.end(prefix), "kind")
    if prefix == "memo":
        # 메모는 날짜·시간을 찾지 않고 쓴 그대로 남긴다 ('블로그 주제: 3시 방향' 같은 글도 있으니까)
        return _result(t, warnings, "memo", t.work.strip())
    if prefix == "goal":
        due = _goal_due(t, today, warnings)
        return _result(t, warnings, "goal", _clean_title(t.work), due=due)

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

    # 3) 반복 → 4) 날짜 → 5) 시간
    rule = _find_repeat(t)
    dates = _find_dates(t, today, warnings)
    start_time, end_time = _find_time(t, warnings)

    repeat = None
    if rule:
        dates, repeat = _apply_repeat(rule, t, today, warnings)
        undated = False
    if undated:
        dates = []
    title = _clean_title(t.work)

    # 6) 루틴: 제목이 루틴 이름과 같으면 일정이 아니라 루틴 기록 (카테고리·D-day는 쓰지 않는다)
    #    [ ] 할 일로 쓴 것과 반복 일정은 루틴 기록으로 보지 않는다
    routine = None
    if prefix != "todo" and not rule:
        routine = next((r for r in routines if title and r["name"].strip().lower() == title.lower()), None)
    routine_today = False
    if routine:
        warnings = [w for w in warnings if "카테고리가 없어서" not in w]
        if category or unknown_tag or dday:
            warnings.append("루틴 기록에는 카테고리와 D-day를 쓰지 않아요.")
        if undated:
            warnings.append("루틴 기록은 날짜가 있어야 해서 오늘로 넣어요.")
        if not dates:  # 루틴 기록은 날짜가 꼭 있어야 하므로, 안 쓰면 오늘 한 것으로
            dates = [today.isoformat()]
            routine_today = True
        category, unknown_tag, dday, undated = None, None, False, False
        kind = "routine"
    else:
        undated = not dates and not rule  # 날짜를 안 쓰면 할 일 (8차)
        if dday and undated:
            warnings.append("할 일(날짜 없음)은 D-day가 보이지 않아요.")
        kind = "schedule" if dates or rule else "todo"

    return _result(
        t, warnings, kind, title,
        dates=dates,
        undated=undated,
        start_time=start_time,
        end_time=end_time,
        category={"id": category["id"], "name": category["name"], "color": category["color"]} if category else None,
        unknown_tag=unknown_tag,
        routine={"id": routine["id"], "name": routine["name"], "emoji": routine["emoji"]} if routine else None,
        routine_today=routine_today,
        dday=dday,
        repeat=repeat,
    )
