"""0.12.0 테스트: 공유 링크·캘린더 구독·위젯(토큰이 열쇠, 끊으면 막힘, 카테고리·메모 걸러 내기),
패스키 등록·로그인·'열 때마다 생체 인증' (테스트용 가짜 인증기로 실제 서명까지 확인)"""

import hashlib
import json
import os
import struct
import time

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from icalendar import Calendar

import auth
import passkeys
from app import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def post(client, path, body, status=201):
    res = client.post(path, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def make_client(tmp_path, password=None):
    if password:
        auth.save_password(str(tmp_path), password)
    return create_app(str(tmp_path / "t.db")).test_client()


def setup_calendar(c):
    cats = {x["name"]: x["id"] for x in c.get("/api/categories").get_json()}
    school = post(c, "/api/categories", {"name": "수업", "color": "#3D6FD9"})["id"]
    secret = post(c, "/api/categories", {"name": "비밀", "color": "#E5534B"})["id"]
    post(c, "/api/items", {"title": "회로이론2", "dates": ["2026-11-16"], "start_time": "13:30", "end_time": "14:45", "category_id": school, "memo": "공학관 301"})
    post(c, "/api/items", {"title": "병원", "dates": ["2026-11-16"], "start_time": "10:00", "category_id": secret})
    post(c, "/api/items", {"title": "가족 저녁", "dates": ["2026-11-20"], "category_id": cats["미분류"], "dday": True})
    return school, secret


# ======================================================================== 공유 링크
def test_share_link_shows_only_chosen_categories_without_memo(tmp_path):
    c = make_client(tmp_path, password="secret1")
    c.post("/login", data={"password": "secret1"})
    school, secret = setup_calendar(c)
    link = post(c, "/api/links", {"kind": "share", "label": "가족용", "options": {"categories": [school]}})
    assert link["url"].startswith("http://localhost/v/") and len(link["url"].rsplit("/", 1)[1]) == 32
    assert link["options"] == {"categories": [school], "memo": False}
    token = link["url"].rsplit("/", 1)[1]

    anon = create_app(str(tmp_path / "t.db")).test_client()            # 로그인 안 한 사람 (받은 사람)
    assert anon.get("/api/items/undated").status_code == 401           # 앱은 여전히 잠겨 있다
    page = anon.get(f"/v/{token}")
    assert page.status_code == 200 and "가족용" in page.get_data(as_text=True)
    assert page.headers["X-Robots-Tag"].startswith("noindex") and page.headers["Referrer-Policy"] == "no-referrer"
    data = anon.get(f"/v/{token}/events?start=2026-11-01&end=2026-12-01").get_json()
    assert [(o["title"], o["memo"]) for o in data["items"]] == [("회로이론2", "")]    # 비밀 카테고리·메모는 안 보인다
    assert "id" not in data["items"][0] and "id" not in data["items"][0]["category"]

    # 메모 보여 주기를 켜고, 카테고리를 '모두'로
    c.put(f"/api/links/{link['id']}", json={"options": {"categories": "all", "memo": True}})
    items = anon.get(f"/v/{token}/events?start=2026-11-01&end=2026-12-01").get_json()["items"]
    assert {o["title"] for o in items} == {"회로이론2", "병원", "가족 저녁"}
    assert next(o for o in items if o["title"] == "회로이론2")["memo"] == "공학관 301"

    # 끊으면 바로 막힌다
    assert c.delete(f"/api/links/{link['id']}").status_code == 200
    gone = anon.get(f"/v/{token}")
    assert gone.status_code == 404 and "끊겼" in gone.get_data(as_text=True)
    assert anon.get(f"/v/{token}/events?start=2026-11-01&end=2026-12-01").status_code == 404
    assert anon.get("/v/not-a-real-token").status_code == 404


def test_link_management_needs_login_and_checks_input(tmp_path):
    c = make_client(tmp_path, password="secret1")
    assert c.get("/api/links").status_code == 401
    assert c.post("/api/links", json={"kind": "share"}).status_code == 401
    c.post("/login", data={"password": "secret1"})
    post(c, "/api/links", {"kind": "mail"}, status=400)
    post(c, "/api/links", {"kind": "share", "options": {"categories": [999]}}, status=400)
    post(c, "/api/links", {"kind": "ics", "options": {"alarm": 7}}, status=400)
    a = post(c, "/api/links", {"kind": "share"})
    b = post(c, "/api/links", {"kind": "share"})
    assert a["label"] == "공유 링크" and a["url"] != b["url"]                       # 링크마다 다른 열쇠
    assert len(c.get("/api/links").get_json()) == 2


# ======================================================================== 캘린더 구독 (.ics)
def test_ics_feed_is_valid_calendar_with_alarms_and_goals(client):
    school, secret = setup_calendar(client)
    post(client, "/api/goals", {"title": "풀업 15개", "due": "2099-12-31"})
    link = post(client, "/api/links", {"kind": "ics", "label": "내 아이폰", "options": {"categories": [school, 1], "alarm": 30}})
    assert link["webcal"].startswith("webcal://localhost/ical/") and link["url"].endswith(".ics")
    path = link["url"].replace("http://localhost", "")
    # 날짜를 고정할 수 없어서 오늘 기준 기간 안에 일정을 하나 더 넣는다
    from links import today_kst
    day = today_kst().isoformat()
    post(client, "/api/items", {"title": "오늘 수업", "dates": [day], "start_time": "09:00", "end_time": "10:15", "category_id": school})
    post(client, "/api/items", {"title": "오늘 비밀", "dates": [day], "start_time": "11:00", "category_id": secret})
    post(client, "/api/items", {"title": "오늘 마감", "dates": [day], "end_time": "23:59"})

    res = client.get(path)
    assert res.status_code == 200 and res.mimetype == "text/calendar"
    cal = Calendar.from_ical(res.data)
    assert str(cal["X-WR-CALNAME"]) == "내 아이폰"
    events = {str(e["SUMMARY"]): e for e in cal.walk("VEVENT")}
    assert "오늘 비밀" not in events                                                 # 고르지 않은 카테고리
    lesson = events["오늘 수업"]
    assert lesson["DTSTART"].dt.hour == 9 and str(lesson["DTSTART"].dt.tzinfo) == "Asia/Seoul"
    assert lesson["DTEND"].dt.minute == 15
    alarm = lesson.walk("VALARM")[0]
    assert alarm["TRIGGER"].dt.total_seconds() == -30 * 60                         # 30분 전 알림
    deadline = events["오늘 마감"]
    assert not hasattr(deadline["DTSTART"].dt, "hour") and "~23:59까지" in str(deadline["DESCRIPTION"])   # 하루 종일 + 끝 시간 메모
    assert not deadline.walk("VALARM")                                             # 시간 없는 일정은 알림 없음
    assert "🎯 풀업 15개 (목표 기한)" in events                                      # 기한 있는 목표
    assert cal.walk("VTIMEZONE")                                                   # 시간대 정보 포함

    client.put(f"/api/links/{link['id']}", json={"options": {"goals": False, "alarm": None}})
    cal = Calendar.from_ical(client.get(path).data)
    assert not any("목표 기한" in str(e["SUMMARY"]) for e in cal.walk("VEVENT"))
    assert not cal.walk("VALARM")
    client.delete(f"/api/links/{link['id']}")
    assert client.get(path).status_code == 404


# ======================================================================== 홈 화면 위젯
def test_widget_json_and_script(client):
    from links import today_kst
    day = today_kst().isoformat()
    run = post(client, "/api/routines", {"name": "운동", "emoji": "🏃"})
    post(client, "/api/goals", {"kind": "life", "title": "건강한 몸"})
    post(client, "/api/goals", {"kind": "year", "year": today_kst().year, "title": "운동 100번", "measure": "routine", "target": 100, "routine_id": run["id"]})
    post(client, "/api/items", {"title": "하루 종일 일", "dates": [day]})
    post(client, "/api/items", {"title": "밤 23시 59분 일정", "dates": [day], "start_time": "23:59"})
    post(client, "/api/items", {"title": "할 일", "dates": []})
    link = post(client, "/api/links", {"kind": "widget"})
    data = client.get(link["url"].replace("http://localhost", "")).get_json()
    assert data["date"] == day and len(data["weekday"]) == 1
    assert [o["title"] for o in data["today"]] == ["하루 종일 일", "밤 23시 59분 일정"]
    assert data["next"]["title"] == "밤 23시 59분 일정" and data["next"]["day"] == "today"
    assert data["year"]["goals"][0] == {"title": "운동 100번", "measure": "routine", "current": 0, "target": 100, "emoji": "🏃"}
    assert data["life"] == "건강한 몸" and data["todos"] == 1

    script = client.get(f"/api/links/{link['id']}/script?accent=%231F7A52")
    code = script.get_data(as_text=True)
    assert script.status_code == 200 and "attachment" in script.headers["Content-Disposition"]
    assert f'const DATA_URL = "{link["url"]}";' in code and 'const ACCENT = "#1F7A52";' in code
    assert "__DATA_URL__" not in code and 'const APP_URL = "http://localhost/";' in code
    bad = client.get(f"/api/links/{link['id']}/script?accent=red").get_data(as_text=True)
    assert 'const ACCENT = "#2347C8";' in bad                                       # 이상한 색은 기본색으로
    share = post(client, "/api/links", {"kind": "share"})
    assert client.get(f"/api/links/{share['id']}/script").status_code == 400


# ======================================================================== 패스키 (테스트용 가짜 인증기)
def b64url(data):
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class SoftAuthenticator:
    """Face ID 대신 테스트에서 쓰는 소프트웨어 인증기: P-256 키를 만들고 WebAuthn 형식으로 서명한다."""

    def __init__(self, rp_id="localhost", origin="http://localhost"):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.rp_id, self.origin = rp_id, origin
        self.count = 0

    def _client_data(self, kind, challenge):
        return json.dumps({"type": kind, "challenge": challenge, "origin": self.origin, "crossOrigin": False}).encode()

    def register(self, options):
        nums = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")})
        auth_data = (hashlib.sha256(self.rp_id.encode()).digest() + bytes([0x45]) + struct.pack(">I", 0)
                     + bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + cose)
        return {
            "id": b64url(self.cred_id), "rawId": b64url(self.cred_id), "type": "public-key",
            "response": {
                "clientDataJSON": b64url(self._client_data("webauthn.create", options["challenge"])),
                "attestationObject": b64url(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
                "transports": ["internal", "hybrid"],
            },
            "clientExtensionResults": {},
        }

    def sign(self, options):
        self.count += 1
        auth_data = hashlib.sha256(self.rp_id.encode()).digest() + bytes([0x05]) + struct.pack(">I", self.count)
        client_data = self._client_data("webauthn.get", options["challenge"])
        sig = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {
            "id": b64url(self.cred_id), "rawId": b64url(self.cred_id), "type": "public-key",
            "response": {"clientDataJSON": b64url(client_data), "authenticatorData": b64url(auth_data), "signature": b64url(sig)},
            "clientExtensionResults": {},
        }


def test_passkey_register_login_and_reject_forgery(tmp_path):
    c = make_client(tmp_path, password="secret1")
    phone = SoftAuthenticator()
    assert c.post("/auth/passkey/register/options", json={}).status_code == 401      # 로그인해야 등록
    c.post("/login", data={"password": "secret1"})
    assert "Face ID" not in c.get("/login", follow_redirects=True).get_data(as_text=True)

    opts = c.post("/auth/passkey/register/options", json={}).get_json()
    assert opts["rp"]["id"] == "localhost" and opts["authenticatorSelection"]["userVerification"] == "required"
    res = c.post("/auth/passkey/register/verify", json={"credential": phone.register(opts)},
                 headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1"})
    assert res.status_code == 201 and res.get_json()["label"] == "iPhone · Safari"
    listing = c.get("/auth/passkey/list").get_json()
    assert [p["label"] for p in listing["passkeys"]] == ["iPhone · Safari"] and listing["lock"] is False
    again = c.post("/auth/passkey/register/options", json={}).get_json()
    assert again["excludeCredentials"][0]["id"] == b64url(phone.cred_id)             # 같은 기기 두 번 등록 막기

    # 다른 기기(새 브라우저)에서 패스키로 로그인
    other = create_app(str(tmp_path / "t.db")).test_client()
    page = other.get("/login").get_data(as_text=True)
    assert 'id="btn-passkey"' in page and "gate.js" in page
    assert other.get("/api/items/undated").status_code == 401
    opts = other.post("/auth/passkey/options", json={"purpose": "login"}).get_json()
    assert opts["allowCredentials"][0]["id"] == b64url(phone.cred_id)
    ok = other.post("/auth/passkey/verify", json={"purpose": "login", "credential": phone.sign(opts)})
    assert ok.status_code == 200 and ok.get_json()["purpose"] == "login"
    assert other.get("/api/items/undated").status_code == 200
    assert c.get("/auth/passkey/list").get_json()["passkeys"][0]["last_used_at"]

    # 등록하지 않은 키, 같은 문제(challenge) 다시 쓰기는 막힌다
    thief = SoftAuthenticator()
    stranger = create_app(str(tmp_path / "t.db")).test_client()
    opts = stranger.post("/auth/passkey/options", json={"purpose": "login"}).get_json()
    forged = thief.sign(opts)
    forged["id"] = forged["rawId"] = b64url(phone.cred_id)                          # 남의 키 번호를 붙여도 서명이 안 맞는다
    assert stranger.post("/auth/passkey/verify", json={"purpose": "login", "credential": forged}).status_code == 401
    assert stranger.post("/auth/passkey/verify", json={"purpose": "login", "credential": phone.sign(opts)}).status_code == 400
    assert stranger.get("/api/items/undated").status_code == 401
    assert stranger.post("/auth/passkey/options", json={"purpose": "unlock"}).status_code == 401   # 잠금 열기는 로그인한 기기만


def test_bio_lock_locks_after_idle_and_unlocks_with_passkey(tmp_path, monkeypatch):
    c = make_client(tmp_path, password="secret1")
    phone = SoftAuthenticator()
    c.post("/login", data={"password": "secret1"})
    opts = c.post("/auth/passkey/register/options", json={}).get_json()
    c.post("/auth/passkey/register/verify", json={"credential": phone.register(opts)})

    assert c.post("/auth/passkey/lock", json={"on": True}).status_code == 400        # 켜려면 패스키로 확인
    opts = c.post("/auth/passkey/options", json={"purpose": "lock"}).get_json()
    assert c.post("/auth/passkey/verify", json={"purpose": "lock", "credential": phone.sign(opts)}).get_json()["lock"] is True
    assert 'data-bio-lock="1"' in c.get("/").get_data(as_text=True)

    # 시간을 앞으로 돌려 '한동안 안 씀'을 흉내
    start = time.time()
    monkeypatch.setattr(passkeys, "now", lambda: start + passkeys.LOCK_IDLE + 5)
    res = c.get("/api/items/undated")
    assert res.status_code == 401 and res.get_json()["locked"] is True
    assert c.get("/?week=2026-11-08").headers["Location"] == "/unlock?next=/?week%3D2026-11-08"
    page = c.get("/unlock").get_data(as_text=True)
    assert "잠겨 있어요" in page and 'data-mode="unlock"' in page
    assert c.get("/api/version").status_code == 401                                  # 동기화 확인도 막힌다

    # 비밀번호로도 열 수 있다 (틀리면 그대로)
    assert c.post("/unlock", data={"password": "nope"}).status_code == 401
    opts = c.post("/auth/passkey/options", json={"purpose": "unlock"}).get_json()
    assert c.post("/auth/passkey/verify", json={"purpose": "unlock", "credential": phone.sign(opts)}).status_code == 200
    assert c.get("/api/items/undated").status_code == 200
    assert c.get("/unlock").status_code == 302                                       # 이미 열렸으면 첫 화면으로

    # 끄기, 그리고 패스키를 다 지우면 잠금도 풀린다
    c.post("/auth/passkey/lock", json={"on": False})
    assert c.get("/auth/passkey/list").get_json()["lock"] is False
    opts = c.post("/auth/passkey/options", json={"purpose": "lock"}).get_json()
    c.post("/auth/passkey/verify", json={"purpose": "lock", "credential": phone.sign(opts)})
    pid = c.get("/auth/passkey/list").get_json()["passkeys"][0]["id"]
    assert c.delete(f"/auth/passkey/{pid}").status_code == 200
    assert c.get("/auth/passkey/list").get_json() == {"passkeys": [], "lock": False, "lock_minutes": 5}


def test_polling_does_not_count_as_use_unless_active(tmp_path, monkeypatch):
    c = make_client(tmp_path, password="secret1")
    phone = SoftAuthenticator()
    c.post("/login", data={"password": "secret1"})
    opts = c.post("/auth/passkey/register/options", json={}).get_json()
    c.post("/auth/passkey/register/verify", json={"credential": phone.register(opts)})
    opts = c.post("/auth/passkey/options", json={"purpose": "lock"}).get_json()
    c.post("/auth/passkey/verify", json={"purpose": "lock", "credential": phone.sign(opts)})

    start = time.time()
    clock = {"now": start}
    monkeypatch.setattr(passkeys, "now", lambda: clock["now"])
    for minute in range(1, 7):                    # 화면을 띄워만 두고 동기화 확인만 계속 → 5분 뒤 잠김
        clock["now"] = start + minute * 60
        status = c.get("/api/version").status_code
    assert status == 401
    clock["now"] = start
    opts = c.post("/auth/passkey/options", json={"purpose": "unlock"}).get_json()
    c.post("/auth/passkey/verify", json={"purpose": "unlock", "credential": phone.sign(opts)})
    for minute in range(1, 7):                    # 사람이 화면을 만지는 동안(X-Active)에는 잠기지 않는다
        clock["now"] = start + minute * 60
        status = c.get("/api/version", headers={"X-Active": "1"}).status_code
    assert status == 200


def test_requirements_and_files_for_new_open_source():
    with open(os.path.join(ROOT, "requirements.txt"), encoding="utf-8") as f:
        req = f.read()
    assert "icalendar" in req and "webauthn" in req
    for name in ("links.js", "security.js", "webauthn.js", "gate.js", "shared.js"):
        assert os.path.isfile(os.path.join(ROOT, "static", "js", name)), name
    with open(os.path.join(ROOT, "static", "widget", "scriptable-widget.js"), encoding="utf-8") as f:
        widget = f.read()
    for family in ("small", "medium", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"):
        assert family in widget
