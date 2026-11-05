"""빠른 입력 해석 테스트 (quickadd.py) — 기준 날짜: 2026-11-04 수요일"""

from datetime import date

import pytest

from quickadd import parse

TODAY = date(2026, 11, 4)  # 수요일
CATS = [
    {"id": 1, "name": "미분류", "color": "#9AA0AA"},
    {"id": 2, "name": "과제", "color": "#E5534B"},
    {"id": 3, "name": "수업", "color": "#3D6FD9"},
    {"id": 4, "name": "Study", "color": "#3FA66B"},
]
ROUTINES = [{"id": 7, "name": "운동", "emoji": "🏃"}]


def p(text, **kw):
    return parse(text, TODAY, CATS, ROUTINES, **kw)


@pytest.mark.parametrize("text, title, dates, start, end", [
    ("내일 3시~5시 스터디", "스터디", ["2026-11-05"], "15:00", "17:00"),
    ("다음 주 월요일 9시 반 회의", "회의", ["2026-11-09"], "09:30", None),
    ("3시부터 5시까지 회의", "회의", [], "15:00", "17:00"),
    ("저녁 8시~10시 알바", "알바", [], "20:00", "22:00"),
    ("6시까지 레포트 제출", "레포트 제출", [], None, "18:00"),
    ("~18:00 서류 제출", "서류 제출", [], None, "18:00"),
    ("모레 오후 2시 30분 면접", "면접", ["2026-11-06"], "14:30", None),
    ("07:00 기상", "기상", [], "07:00", None),     # 0으로 시작하면 쓴 그대로
    ("15:30 팀플", "팀플", [], "15:30", None),
    ("밤 11시 일기", "일기", [], "23:00", None),
    ("정오 점심 약속", "점심 약속", [], "12:00", None),
    ("3일 뒤 병원 오전 10시", "병원", ["2026-11-07"], "10:00", None),
    ("1주일 뒤 발표", "발표", ["2026-11-11"], None, None),
    ("다음 달 3일 정기검진", "정기검진", ["2026-12-03"], None, None),
    ("내일모레 시험", "시험", ["2026-11-06"], None, None),
])
def test_dates_and_times(text, title, dates, start, end):
    r = p(text)
    assert (r["title"], r["dates"], r["start_time"], r["end_time"]) == (title, dates, start, end)


def test_am_pm_guess_without_meridiem():
    """오전·오후를 안 쓰면 1~7시는 오후, 8~12시는 그대로"""
    assert p("7시 스터디")["start_time"] == "19:00"
    assert p("9시 수업")["start_time"] == "09:00"
    assert p("12시 점심")["start_time"] == "12:00"
    assert p("오전 7시 기상")["start_time"] == "07:00"


def test_weekdays():
    assert p("금요일까지 레포트")["dates"] == ["2026-11-06"]          # 가장 가까운 금요일
    assert p("수요일 회의")["dates"] == ["2026-11-04"]                # 오늘이 수요일이면 오늘
    assert p("이번 주 일요일 대청소")["dates"] == ["2026-11-08"]      # 주는 월요일부터
    assert p("다음 주 금 발표")["dates"] == ["2026-11-13"]
    assert p("지난주 금요일 회고")["dates"] == ["2026-10-30"]


def test_month_day_and_year_rollover():
    assert p("11/20 시험")["dates"] == ["2026-11-20"]
    assert p("11월 20일 시험")["dates"] == ["2026-11-20"]
    assert p("2027-03-02 개강")["dates"] == ["2027-03-02"]
    assert p("1/15 시험")["dates"] == ["2027-01-15"]   # 두 달 넘게 지난 날짜 → 내년
    assert p("10/20 회고")["dates"] == ["2026-10-20"]  # 조금 지난 날짜는 올해
    assert p("20일 월세")["dates"] == ["2026-11-20"]
    assert p("3일 회의")["dates"] == ["2026-12-03"]    # 이번 달 3일은 지났으니 다음 달


def test_ranges_and_multiple_dates():
    days = ["2026-11-20", "2026-11-21", "2026-11-22"]
    assert p("11/20~11/22 동아리 MT")["dates"] == days
    assert p("11/20~22 동아리 MT")["dates"] == days
    assert p("11월 20일~22일 여행")["dates"] == days
    assert p("내일, 금요일 스터디")["dates"] == ["2026-11-05", "2026-11-06"]


def test_category_dday_and_undated():
    r = p("금요일 레포트 #과제 !")
    assert r["category"]["name"] == "과제" and r["dday"] is True and r["title"] == "레포트"
    assert p("발표 준비 #stu")["category"]["name"] == "Study"  # 대소문자 무시 + 앞부분만 써도
    r = p("뭔가 #없는것")
    assert r["category"] is None and r["unknown_tag"] == "없는것" and r["warnings"]

    r = p("언젠가 책 정리")
    assert r["undated"] is True and r["dates"] == [] and r["title"] == "책 정리"


def test_no_date_goes_to_undated():
    """8차: 날짜를 안 쓰면 오늘이 아니라 기한 미정"""
    r = p("장보기")
    assert r["dates"] == [] and r["undated"] is True
    r = p("3시 회의 !")
    assert r["dates"] == [] and r["start_time"] == "15:00" and r["warnings"]  # 기한 미정이면 D-day가 안 보인다고 알림


def test_routine_name_makes_a_routine_record():
    """제목이 루틴 이름이면 일정이 아니라 루틴 기록. 날짜를 안 쓰면 오늘, 카테고리·D-day는 쓰지 않는다"""
    r = p("운동 7시")
    assert r["routine"] == {"id": 7, "name": "운동", "emoji": "🏃"}
    assert r["dates"] == ["2026-11-04"] and r["routine_today"] is True and r["start_time"] == "19:00"
    assert r["category"] is None and r["undated"] is False

    r = p("내일 운동 #과제 !")
    assert r["dates"] == ["2026-11-05"] and r["routine_today"] is False
    assert r["category"] is None and r["dday"] is False and r["warnings"]


def test_things_that_are_not_dates_stay_in_title():
    assert p("2시간 공부")["title"] == "2시간 공부" and p("2시간 공부")["start_time"] is None
    assert p("3일차 복습")["title"] == "3일차 복습"
    assert p("금융 공부")["title"] == "금융 공부"
    r = p("2/30 테스트")
    assert r["title"] == "2/30 테스트" and r["warnings"]  # 없는 날짜는 알려 주고 제목에 남김


def test_spans_point_at_original_text():
    text = "내일 3시 스터디 #과제"
    r = p(text)
    kinds = {text[s["start"]:s["end"]].strip(): s["kind"] for s in r["spans"]}
    assert kinds == {"내일": "date", "3시": "time", "#과제": "category"}


def test_spans_never_overlap():
    """화면에 '어디를 무엇으로 읽었는지' 표시할 때 같은 글자가 두 번 나오지 않게"""
    for text in ["운동 7시~8시 #과제 !", "3시 회의 #과제", "내일 6시까지 레포트 ! #과제", "11/20~22 MT #개인 !"]:
        spans = sorted(p(text)["spans"], key=lambda s: s["start"])
        for a, b in zip(spans, spans[1:]):
            assert a["end"] <= b["start"], (text, spans)
        assert all(text[s["start"]:s["end"]].strip() == text[s["start"]:s["end"]] for s in spans), text
