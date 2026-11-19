"""
시연용 캘린더 — python app.py --demo

- 실제 데이터(instance/calendar.db)와 완전히 분리된 instance/demo/ 폴더를 쓴다.
- 실행할 때마다 처음 상태로 지우고, '실행한 날짜'를 기준으로 예시 일정을 다시 채운다.
  → 언제 실행해도 이번 달·이번 주에 일정이 보인다.
- 로그인 없이 바로 열린다 (내 비밀번호와도 무관).

예시 일정은 앱의 기능(반복·여러 날짜, 시작·끝 시간, 끝 시간만, 카테고리, 루틴,
메모장의 메모·목표·할 일, D-day 등)이 한눈에 보이도록 골랐다. 일정은 실제 API(/api/...)를 그대로 거쳐서 넣는다.
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

    def item(title, category, dates, start=None, end=None, memo="", dday=False):
        body = {
            "title": title,
            "category_id": cat.get(category),  # None이면 미분류
            "dates": [d if isinstance(d, str) else d.isoformat() for d in dates],
            "start_time": start,
            "end_time": end,
            "memo": memo,
            "dday": dday,
        }
        return post("/api/items", body)

    # 시간표 (0.13.0): 매주 반복되는 수업·알바는 일정 대신 시간표로 (0.12까지는 '날짜 여러 개짜리 반복 일정'이었다)
    first = today.replace(day=1)
    period_start = first - timedelta(days=60)
    period_end = (first + timedelta(days=62)).replace(day=1) - timedelta(days=1)
    school = post("/api/timetables", {"name": "2학기 수업", "color": "#3D6FD9", "start_date": period_start.isoformat(),
                                      "end_date": period_end.isoformat(), "skip_holidays": True})
    job = post("/api/timetables", {"name": "알바", "color": "#F08C2E", "skip_holidays": False})

    def block(table, title, weekdays, start, end, place=""):
        return post(f"/api/timetables/{table['id']}/blocks", {
            "title": title, "weekdays": weekdays, "start_time": start, "end_time": end, "place": place,
        })["blocks"]

    comp = block(school, "컴퓨터구조", [1, 3], "09:00", "10:15", "공학관 301")
    block(school, "회로이론2", [2, 4], "13:30", "14:45", "공학관 405")
    block(school, "선형대수", [3], "15:00", "16:15", "미래관 202")
    block(school, "딥러닝", [5], "10:30", "12:00", "프론티어관 107")
    block(job, "카페 알바", [5], "18:00", "22:00", "학교 앞 카페")
    block(job, "카페 알바", [6], "12:00", "17:00", "학교 앞 카페")
    # 다음 주 수요일 컴퓨터구조는 휴강 ('이날만 쉬기')
    wed = today + timedelta(days=7)
    while wed.weekday() != 2:
        wed += timedelta(days=1)
    client.put("/api/timetable-skips", json={"timetable_id": school["id"], "block_id": comp[1]["id"], "date": wed.isoformat()})

    # 오늘과 그 주변
    item("오늘 할 일 정리", None, [today])
    item("스터디", "과제", [today], "19:00", "21:00", "3장 문제 풀이")
    item("선형대수 퀴즈", "과제", [today + timedelta(days=2)], "10:30", memo="행렬식", dday=True)
    item("레포트 제출", "과제", [today + timedelta(days=4)], end="23:59")          # 끝 시간만
    item("장보기", "개인", [today + timedelta(days=1)], memo="세제, 우유")
    item("동아리 MT", "개인", [today + timedelta(days=d) for d in (9, 10, 11)])    # 연속 날짜
    item("도서관 책 반납", None, [today + timedelta(days=6)])

    item("회로이론2 기말고사", "수업", [today + timedelta(days=33)], "13:00", "15:00", dday=True)

    # 메모장 — 할 일 (날짜 없는 일정. 0.8까지의 '기한 미정')
    item("읽고 싶은 책 정리", "개인", [])
    item("노트북 배터리 교체 알아보기", None, [])
    item("교수님께 면담 메일 보내기", "수업", [], memo="학부연구생 관련")
    done = item("자취방 관리비 이체", None, [])
    client.put(f"/api/items/{done['id']}/done", json={"done": True})   # 완료한 할 일
    # 급한 할 일 (0.13.0): 첫 화면 '오늘 챙길 것' 줄에 ⚡로
    post("/api/items", {"title": "장학금 서류 제출", "dates": [], "urgent": True})

    # 루틴 (8차): 이모지 + 이름. 루틴 기록은 일정과 따로 저장된다
    #   → 하루 화면의 '루틴' 구역, 맨 아래 버튼의 '어제'·'2일 전', 월간·주간 화면의 '🏃 운동'
    routine = {
        name: post("/api/routines", {"name": name, "emoji": emoji})["id"]
        for name, emoji in (("운동", "🏃"), ("독서", "📖"), ("영어 단어", "🔤"))
    }

    def log(name, day, start=None, end=None, memo=""):
        return post("/api/routine-logs", {
            "routine_id": routine[name], "date": day.isoformat(), "start_time": start, "end_time": end, "memo": memo,
        })

    log("운동", today - timedelta(days=3), "07:00", "08:00", "5km 러닝")
    log("운동", today - timedelta(days=1), "07:00", "07:40", "풀업 5세트")
    log("독서", today - timedelta(days=2), "22:00", "22:40", "30쪽")
    log("독서", today, "23:00", memo="자기 전 20쪽")
    log("영어 단어", today, memo="30개")
    # 올해 들어 꾸준히 한 운동 (0.11.0: '운동 100번' 올해 목표가 이 기록 수로 채워진다)
    back = 6
    while (today - timedelta(days=back)).year == today.year:
        log("운동", today - timedelta(days=back), "07:00", "07:40")
        back += 5

    # 메모장 (7차): 첫 메모가 메인 → 배너 글귀가 달력 위에 보인다
    post("/api/notes", {
        "title": "힘들 때 읽을 것",
        "banner": "오늘 걷는 한 걸음이 내일의 나를 만든다",
        "body": "완벽하지 않아도 괜찮아. 어제보다 조금만 나아가면 돼.\n지칠 땐 10분 산책하고 다시 시작하기.",
    })
    post("/api/notes", {"title": "잊지 말 것", "body": "부모님께 주 1회 전화\n잠은 7시간 이상\n물 자주 마시기"})
    # 그때그때 적은 한 줄 메모 (0.9.0: 메모장 맨 위 칸이나 빠른 입력의 '- '로)
    post("/api/notes", {"body": "블로그 주제: 파이프라인 해저드를 그림으로 정리해 보기"})
    post("/api/notes", {"body": "MT 챙길 것 — 보조배터리, 담요, 상비약"})
    # 마크다운 메모 (0.10.0): 보기 화면에서 체크리스트를 바로 누를 수 있다
    post("/api/notes", {
        "title": "이번 주 공부",
        "body": "## 시험 범위\n- [x] 선형대수 1~3장\n- [ ] 회로이론2 4장 **페이저**\n- [ ] 컴퓨터구조 파이프라인 정리\n\n"
                "> 하루에 한 과목씩\n\n참고: [강의자료](https://example.com)",
    })

    # 메모장 — 목표 (0.9.0): 기한이 있으면 달력 위 D-day 띠에 🎯로 보인다
    month_end = (first + timedelta(days=62)).replace(day=1) - timedelta(days=1)  # 다음 달 말일
    pullup = post("/api/goals", {"title": "풀업 15개", "due": month_end.isoformat(), "memo": "지금 8개 → 주 3회 연습"})
    post("/api/goals", {"title": "토익 900점", "memo": "매일 단어 30개"})
    reached = post("/api/goals", {"title": "이번 학기 지각 0번"})
    client.put(f"/api/goals/{reached['id']}", json={"done": True})   # 이룬 목표

    # 인생 목표 → 올해 목표 → 기한 목표 (0.11.0)
    #   올해 목표의 진행 방식 셋: 루틴 연결(운동 기록 수를 알아서 셈) / 숫자(+1 버튼) / 체크
    body = post("/api/goals", {"kind": "life", "title": "건강한 몸과 마음", "memo": "오래 달릴 수 있는 사람"})
    craft = post("/api/goals", {"kind": "life", "title": "좋아하는 일을 잘하는 사람"})
    workout = post("/api/goals", {
        "kind": "year", "year": today.year, "title": "운동 100번", "parent_id": body["id"],
        "measure": "routine", "target": 100, "routine_id": routine["운동"],
    })
    post("/api/goals", {
        "kind": "year", "year": today.year, "title": "책 12권", "parent_id": craft["id"],
        "measure": "count", "target": 12, "current": 7,
    })
    post("/api/goals", {"kind": "year", "year": today.year, "title": "개인 프로젝트 하나 끝내기", "parent_id": craft["id"]})
    client.put(f"/api/goals/{pullup['id']}", json={"parent_id": workout["id"]})   # '풀업 15개'는 '운동 100번' 아래에

    seed_v013(client, post, today, cat)

    # 달력 꾸미기 (0.11.0): 날짜 스티커와 형광펜
    client.put(f"/api/days/{(today + timedelta(days=2)).isoformat()}/mark", json={"sticker": "🎂", "color": "pink"})
    client.put(f"/api/days/{(today + timedelta(days=9)).isoformat()}/mark", json={"sticker": "✈️"})
    client.put(f"/api/days/{(today - timedelta(days=4)).isoformat()}/mark", json={"color": "yellow"})


def seed_v013(client, post, today, cat):
    """0.13.0: 습관, 기념일, 프로젝트"""
    # 습관: 물은 며칠째 채우는 중(🔥), 스트레칭은 아직, 영양제는 오늘 끝
    habits = {name: post("/api/habits", {"name": name, "emoji": emoji, "target": target})
              for name, emoji, target in (("물", "💧", 8), ("스트레칭", "🧘", 1), ("영양제", "💊", 1))}

    def step(name, day, times):
        for _ in range(times):
            client.post(f"/api/habits/{habits[name]['id']}/step", json={"date": day.isoformat(), "delta": 1})

    for back in range(1, 7):
        step("물", today - timedelta(days=back), 8)
        if back % 2:
            step("스트레칭", today - timedelta(days=back), 1)
    step("물", today, 5)
    step("영양제", today, 1)

    # 기념일: 음력 생일(2주 뒤), 날짜 세기(곧 400일), 해마다 돌아오는 날
    try:
        from korean_lunar_calendar import KoreanLunarCalendar
        lunar = KoreanLunarCalendar()
        lunar.setSolarDate(*(today + timedelta(days=12)).timetuple()[:3])
        post("/api/anniversaries", {"title": "엄마 생신", "emoji": "🎂", "kind": "birthday", "lunar": True,
                                    "date": f"1970-{lunar.lunarMonth:02d}-{lunar.lunarDay:02d}", "leap": bool(lunar.isIntercalation)})
    except ImportError:
        post("/api/anniversaries", {"title": "엄마 생신", "emoji": "🎂", "kind": "birthday", "date": (today + timedelta(days=12)).replace(year=1970).isoformat()})
    post("/api/anniversaries", {"title": "만난 날", "emoji": "💕", "kind": "days", "date": (today - timedelta(days=394)).isoformat()})
    entrance = today + timedelta(days=20)
    post("/api/anniversaries", {"title": "입학", "emoji": "🎓", "kind": "yearly", "date": entrance.replace(year=today.year - 2).isoformat(), "dday": False})

    # 프로젝트: 마감이 있는 것(세부 할 일·연결한 일정), 대략 정한 것, 잠시 멈춘 것
    term = post(f"/api/projects?today={today.isoformat()}", {"title": "오픈소스 텀프로젝트", "start_date": (today - timedelta(days=30)).isoformat(),
                                                           "end_date": (today + timedelta(days=18)).isoformat(), "memo": "1.0.0을 제출한다"})
    for title, done in (("README 정리", True), ("스크린샷 다시 찍기", False), ("발표 자료 만들기", False)):
        t = post("/api/items", {"title": title, "dates": [], "project_id": term["id"]})
        if done:
            client.put(f"/api/items/{t['id']}/done", json={"done": True})
    post("/api/items", {"title": "버전 태그 붙이기", "dates": [], "project_id": term["id"], "urgent": True})
    post("/api/items", {"title": "텀프로젝트 중간 점검", "dates": [(today + timedelta(days=5)).isoformat()], "start_time": "16:00",
                        "category_id": cat.get("과제"), "project_id": term["id"]})
    m1 = (today.replace(day=1) + timedelta(days=62)).month
    m2 = m1 % 12 + 1
    post(f"/api/projects?today={today.isoformat()}", {"title": "자취방 구하기", "when": f"{m1}~{m2}월", "memo": "서울 안, 지하철 두 노선 이상"})
    post(f"/api/projects?today={today.isoformat()}", {"title": "블로그 글 10편", "status": "paused"})
