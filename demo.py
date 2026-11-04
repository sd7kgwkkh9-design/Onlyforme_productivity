"""
시연용 캘린더 — python app.py --demo

- 실제 데이터(instance/calendar.db)와 완전히 분리된 instance/demo/ 폴더를 쓴다.
- 실행할 때마다 처음 상태로 지우고, '실행한 날짜'를 기준으로 예시 일정을 다시 채운다.
  → 언제 실행해도 이번 달·이번 주에 일정이 보인다.
- 로그인 없이 바로 열린다 (내 비밀번호와도 무관).

예시 일정은 앱의 기능(여러 날짜, 시작·끝 시간, 끝 시간만, 기한 미정, 카테고리,
루틴, 마음 노트, D-day 등)이 한눈에 보이도록 골랐다. 일정은 실제 API(/api/...)를 그대로 거쳐서 넣는다.
"""

import os
import shutil
from datetime import date, timedelta

CATEGORIES = [("수업", "#3D6FD9"), ("과제", "#E5534B"), ("알바", "#3FA66B"), ("개인", "#7C5CD6")]


def demo_database_path(base_dir):
    return os.path.join(base_dir, "instance", "demo", "calendar.db")


def reset_demo_folder(base_dir):
    folder = os.path.dirname(demo_database_path(base_dir))
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, exist_ok=True)


def _weekdays(start, end, weekdays):
    """start~end(포함) 중 요일이 weekdays(월=0 … 일=6)인 날짜들"""
    out = []
    d = start
    while d <= end:
        if d.weekday() in weekdays:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def seed_demo(app, today=None):
    """app(빈 DB)에 예시 일정을 채운다."""
    today = today or date.today()
    client = app.test_client()

    def post(path, body):
        res = client.post(path, json=body)
        if res.status_code != 201:
            raise RuntimeError(f"시연용 데이터를 넣지 못했어요: {res.get_json()}")
        return res.get_json()

    cat = {name: post("/api/categories", {"name": name, "color": color})["id"] for name, color in CATEGORIES}

    def item(title, category, dates, start=None, end=None, memo="", dday=False, routine=None):
        body = {
            "title": title,
            "category_id": cat.get(category),  # None이면 미분류
            "dates": [d if isinstance(d, str) else d.isoformat() for d in dates],
            "start_time": start,
            "end_time": end,
            "memo": memo,
            "dday": dday,
        }
        if routine:
            body["routine_id"] = routine
        return post("/api/items", body)

    # 지난달 말 ~ 다음 달 말까지 반복 수업·알바 (한 일정에 날짜 여러 개)
    first = today.replace(day=1)
    period_start = first - timedelta(days=7)
    period_end = (first + timedelta(days=62)).replace(day=1) - timedelta(days=1)

    item("컴퓨터구조", "수업", _weekdays(period_start, period_end, {0, 2}), "09:00", "10:15", "공학관 301호")
    item("회로이론2", "수업", _weekdays(period_start, period_end, {1, 3}), "13:30", "14:45")
    item("카페 알바", "알바", _weekdays(period_start, period_end, {4}), "18:00", "22:00")

    # 오늘과 그 주변
    item("오늘 할 일 정리", None, [today])
    item("스터디", "과제", [today], "19:00", "21:00", "3장 문제 풀이")
    item("선형대수 퀴즈", "과제", [today + timedelta(days=2)], "10:30", memo="행렬식", dday=True)
    item("레포트 제출", "과제", [today + timedelta(days=4)], end="23:59")          # 끝 시간만
    item("장보기", "개인", [today + timedelta(days=1)], memo="세제, 우유")
    item("동아리 MT", "개인", [today + timedelta(days=d) for d in (9, 10, 11)])    # 연속 날짜
    item("도서관 책 반납", None, [today + timedelta(days=6)])

    item("회로이론2 기말고사", "수업", [today + timedelta(days=33)], "13:00", "15:00", dday=True)

    # 기한 미정
    item("읽고 싶은 책 정리", "개인", [])
    item("노트북 배터리 교체 알아보기", None, [])

    # 루틴 (7차): 버튼 3개 + 지난 며칠의 기록 → 하루 화면 아래에 '3일 전', '어제'처럼 보인다
    routine = {
        name: post("/api/routines", {"name": name, "category_id": cat[category]})["id"]
        for name, category in (("운동", "개인"), ("독서", "개인"), ("영어 단어", "과제"))
    }
    item("운동", "개인", [today - timedelta(days=3)], "07:00", "08:00", memo="5km 러닝", routine=routine["운동"])
    item("운동", "개인", [today - timedelta(days=1)], "07:00", "07:40", memo="풀업 5세트", routine=routine["운동"])
    item("독서", "개인", [today - timedelta(days=2)], "22:00", "22:40", memo="30쪽", routine=routine["독서"])

    # 마음 노트 (7차): 첫 메모가 메인 → 배너 글귀가 달력 위에 보인다
    post("/api/notes", {
        "title": "힘들 때 읽을 것",
        "banner": "오늘 걷는 한 걸음이 내일의 나를 만든다",
        "body": "완벽하지 않아도 괜찮아. 어제보다 조금만 나아가면 돼.\n지칠 땐 10분 산책하고 다시 시작하기.",
    })
    post("/api/notes", {"title": "잊지 말 것", "body": "부모님께 주 1회 전화\n잠은 7시간 이상\n물 자주 마시기"})
