"""
캘린더만 잠그기 (0.13.0)

회사·학교처럼 남들과 같이 쓰는 컴퓨터에서 캘린더를 띄워 두고 잠깐 자리를 비울 때,
컴퓨터 전체를 잠그기는 애매하니 이 캘린더만 잠근다.

- 지금 잠그기 (🔒 버튼, 단축키 L): 바로 잠금 화면(/unlock)으로 바뀐다.
- 자동 잠금: 정한 시간(1·3·5·10·15·30분) 동안 안 쓰면 잠긴다. 0.12.0의 '열 때마다 생체 인증'을 넓힌 것이다.
- 푸는 방법: PIN(4~8자리 숫자) · 패스키(Face ID·지문) · 비밀번호. PIN을 5번 틀리면 그 기기에서는 비밀번호·패스키로만 열린다.
- 공용 PC 모드: 로그인을 1년 동안 유지하지 않고 브라우저를 닫으면 로그아웃된다. 이 기기에 띠 내용 등을 남기지 않는다.
- 자리를 비우면 가리기: 캘린더 창을 떠나면(다른 창·탭을 누르면) 화면을 흐리게 가린다 (화면 쪽 main.js).

잠금은 화면만 가리는 게 아니다. 로그인 쿠키(세션)에 '잠김'을 적어 두고 서버가 검사하므로(auth.py의 require_login),
새로 고침하거나 주소를 직접 쳐도 잠금 화면이 뜨고, 잠긴 동안에는 API도 일정을 돌려주지 않는다.
설정은 기기(브라우저)마다 따로다 — 집 노트북은 잠금 없이, 회사 컴퓨터는 3분 자동 잠금처럼.
PIN은 하나만 두고, 비밀번호처럼 해시로만 instance/auth.json에 저장한다.

  GET    /auth/lock            이 기기의 잠금 설정
  POST   /auth/lock/now        지금 잠그기
  PUT    /auth/lock/settings   {auto, minutes, public, blur} 보낸 칸만
  POST   /auth/lock/pin        PIN 정하기·바꾸기 {pin, password} — 비밀번호를 한 번 더 확인한다
  DELETE /auth/lock/pin        PIN 지우기
"""

import re

from flask import Blueprint, current_app, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import auth
import passkeys

bp = Blueprint("lock", __name__, url_prefix="/auth/lock")

MINUTE_CHOICES = (1, 3, 5, 10, 15, 30)
DEFAULT_MINUTES = 5
PIN_RE = re.compile(r"^\d{4,8}$")
MAX_PIN_FAILS = 5


class LockError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@bp.errorhandler(LockError)
def handle_error(err):
    return jsonify(error=err.message), err.status


def data_dir():
    return current_app.config["DATA_DIR"]


# ---------------------------------------------------------------- PIN
def has_pin():
    return bool(auth.load_auth(data_dir()).get("pin_hash"))


def check_pin(pin):
    hashed = auth.load_auth(data_dir()).get("pin_hash")
    return bool(hashed) and bool(PIN_RE.match(pin or "")) and check_password_hash(hashed, pin)


def pin_allowed():
    return int(session.get("pin_fails") or 0) < MAX_PIN_FAILS


def pin_failed():
    session["pin_fails"] = int(session.get("pin_fails") or 0) + 1


def pin_tries_left():
    return max(0, MAX_PIN_FAILS - int(session.get("pin_fails") or 0))


def unlocked():
    """잠금을 풀었을 때 (PIN·비밀번호·패스키 어느 것으로든)"""
    session.pop("locked", None)
    session.pop("pin_fails", None)
    session["seen"] = passkeys.now()


# ---------------------------------------------------------------- 설정
def minutes():
    value = session.get("lock_min")
    return value if value in MINUTE_CHOICES else DEFAULT_MINUTES


def client_settings():
    """첫 화면(index.html)에 실어 보내는 이 기기의 설정 — 화면이 가리기·공용 PC 동작을 정할 때 쓴다"""
    return {
        "login": auth.login_required(),
        "auto": bool(session.get("bio_lock")),
        "minutes": minutes(),
        "public": bool(session.get("public")),
        "blur": bool(session.get("blur")),
    }


def need_login():
    if not auth.login_required():
        raise LockError("비밀번호를 정해야 잠글 수 있어요. (python app.py --set-password)", 400)
    if not session.get("logged_in"):
        raise LockError("로그인이 필요해요.", 401)


@bp.get("")
def get_settings():
    need_login()
    return jsonify(
        **client_settings(),
        pin=has_pin(),
        passkeys=len(passkeys.rows()),
        choices=list(MINUTE_CHOICES),
    )


@bp.post("/now")
def lock_now():
    need_login()
    session["locked"] = True
    return jsonify(locked=True, url="/unlock")


@bp.put("/settings")
def update_settings():
    need_login()
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise LockError("요청 형식이 올바르지 않아요.")
    for key in ("auto", "public", "blur"):
        if key in data and not isinstance(data[key], bool):
            raise LockError(f"{key}는 true/false여야 해요.")
    if "minutes" in data:
        if data["minutes"] not in MINUTE_CHOICES:
            raise LockError("자동 잠금 시간은 1·3·5·10·15·30분 중에서 골라 주세요.")
        session["lock_min"] = data["minutes"]
    if "auto" in data:
        if data["auto"]:
            session["bio_lock"] = True        # 0.12.0과 같은 이름 (그때 켠 기기는 그대로 켜져 있다)
            session["seen"] = passkeys.now()
        else:
            session.pop("bio_lock", None)
    if "public" in data:
        session["public"] = data["public"]
        # 공용 PC: 쿠키에 만료일을 붙이지 않는다 → 브라우저를 닫으면 로그인이 풀린다
        session.permanent = not data["public"]
    if "blur" in data:
        session["blur"] = data["blur"]
    return get_settings()


@bp.post("/pin")
def set_pin():
    need_login()
    data = request.get_json(silent=True) or {}
    pin = str(data.get("pin") or "")
    if not PIN_RE.match(pin):
        raise LockError("PIN은 숫자 4~8자리로 정해 주세요.")
    if len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        raise LockError("1111, 1234처럼 쉬운 PIN은 쓸 수 없어요.")
    ip = auth._client_ip()
    wait = auth._locked_seconds_left(ip)
    if wait:
        raise LockError(f"여러 번 틀려서 잠시 막혔어요. {wait}초 뒤에 다시 시도해 주세요.", 429)
    if not auth.check_password(data.get("password")):
        auth._record_fail(ip)
        raise LockError("비밀번호가 맞지 않아요.", 401)
    stored = auth.load_auth(data_dir())
    stored["pin_hash"] = generate_password_hash(pin)
    auth.save_auth(data_dir(), stored)
    session.pop("pin_fails", None)
    return get_settings()


@bp.delete("/pin")
def delete_pin():
    need_login()
    stored = auth.load_auth(data_dir())
    stored.pop("pin_hash", None)
    auth.save_auth(data_dir(), stored)
    return get_settings()
