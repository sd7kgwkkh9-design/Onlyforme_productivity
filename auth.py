"""
로그인 — 비밀번호 하나로 나만 쓰는 캘린더 지키기

비밀번호 정하기 (처음 한 번, 서버에서):
    python app.py --set-password

- 비밀번호는 그대로 저장하지 않고 '해시'(되돌릴 수 없게 바꾼 값)로만 instance/auth.json에 저장한다.
- 로그인하면 기기마다 1년 동안 유지된다 (쿠키 세션).
- 비밀번호를 연달아 틀리면 잠시 로그인을 막는다 (무작위 대입 공격 방지).
- 0.12.0: 패스키(Face ID·지문)로도 로그인할 수 있고, 기기마다 '열 때마다 생체 인증'을 켤 수 있다 (passkeys.py).
  잠금을 켠 기기는 몇 분 넘게 안 쓰다가 다시 열면 /unlock 화면이 뜬다.
- 0.12.0: 공유 링크(/v/), 캘린더 구독(/ical/), 위젯(/w/)은 비밀번호 대신 주소 안의 토큰으로 연다 (links.py).
- 0.13.0: 캘린더만 잠그기 (lock.py) — '지금 잠그기', 자동 잠금 시간, PIN으로 열기, 공용 PC 모드.
  잠긴 화면(/unlock)에서는 PIN · 패스키 · 비밀번호 중 하나로 연다.

동작 방식:
- 내 컴퓨터에서 python app.py로 실행할 때: 비밀번호를 정해 두었을 때만 로그인을 요구한다.
- 인터넷 서버(wsgi.py)로 실행할 때: 비밀번호가 없으면 아예 열리지 않는다 (실수로 공개되는 것 방지).
"""

import json
import os
import secrets
import time
from datetime import timedelta

from flask import (
    Blueprint,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

import passkeys

bp = Blueprint("auth", __name__)

MAX_FAILS = 5            # 이만큼 연달아 틀리면
LOCK_SECONDS = 60        # 이 시간 동안 로그인 막기
MIN_PASSWORD_LENGTH = 4

_fails = {}  # IP 주소 → (연속 실패 횟수, 막힌 시각)


# ---------------------------------------------------------------- 파일 저장
def _auth_file(data_dir):
    return os.path.join(data_dir, "auth.json")


def load_auth(data_dir):
    """auth.json 전체 {password_hash, pin_hash(0.13.0)}"""
    try:
        with open(_auth_file(data_dir), encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def save_auth(data_dir, data):
    os.makedirs(data_dir, exist_ok=True)
    with open(_auth_file(data_dir), "w", encoding="utf-8") as f:
        json.dump(data, f)


def load_password_hash(data_dir):
    return load_auth(data_dir).get("password_hash")


def save_password(data_dir, password):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 해요.")
    data = load_auth(data_dir)   # 잠금 PIN(0.13.0)은 그대로 둔다
    data["password_hash"] = generate_password_hash(password)
    save_auth(data_dir, data)


def check_password(password):
    hashed = load_password_hash(current_app.config["DATA_DIR"])
    return bool(hashed) and check_password_hash(hashed, password or "")


def load_or_create_secret_key(data_dir):
    """로그인 쿠키에 서명할 비밀 키. 처음 실행할 때 무작위로 만들고 파일에 저장해 둔다."""
    path = os.path.join(data_dir, "secret_key")
    try:
        with open(path, encoding="utf-8") as f:
            key = f.read().strip()
            if key:
                return key
    except FileNotFoundError:
        pass
    key = secrets.token_hex(32)
    os.makedirs(data_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(key)
    return key


# ---------------------------------------------------------------- 앱에 연결
def init_auth(app, data_dir, production):
    app.config["DATA_DIR"] = data_dir
    app.config["PRODUCTION"] = production
    app.secret_key = load_or_create_secret_key(data_dir)
    app.config.update(
        PERMANENT_SESSION_LIFETIME=timedelta(days=365),
        SESSION_COOKIE_HTTPONLY=True,          # 자바스크립트가 쿠키를 못 읽게
        SESSION_COOKIE_SAMESITE="Lax",         # 다른 사이트에서 보낸 요청에는 쿠키를 안 붙이게
        SESSION_COOKIE_SECURE=production,      # 인터넷 서버에서는 https로만
    )
    app.register_blueprint(bp)
    app.before_request(require_login)


def login_required():
    """비밀번호를 정해 두었으면 로그인이 필요하다."""
    return load_password_hash(current_app.config["DATA_DIR"]) is not None


# 로그인 없이 열리는 주소: 토큰이 열쇠인 공유·구독·위젯, 패스키로 로그인하기
PUBLIC_PREFIXES = ("/static/", "/v/", "/ical/", "/w/")
PUBLIC_PATHS = ("/login", "/logout", "/auth/passkey/options", "/auth/passkey/verify")
# 잠겨 있어도 열리는 주소: 잠금 화면과 그 화면에서 쓰는 것
UNLOCK_PATHS = ("/unlock", "/logout", "/auth/passkey/options", "/auth/passkey/verify")


def require_login():
    path = request.path
    if path.startswith(PUBLIC_PREFIXES) or path in PUBLIC_PATHS:
        return None

    if not login_required():
        if current_app.config["PRODUCTION"]:
            # 인터넷 서버인데 비밀번호가 없으면 열지 않는다.
            if path.startswith("/api/"):
                return jsonify(error="비밀번호가 아직 설정되지 않았어요."), 503
            return render_template("setup_needed.html"), 503
        return None

    if session.get("logged_in"):
        # 이 기기에서 '열 때마다 생체 인증'을 켜 두었고 한동안 안 썼으면 잠금 화면으로 (passkeys.py)
        if passkeys.is_locked():
            if path in UNLOCK_PATHS:
                return None   # 잠금 화면과 그 화면의 확인 요청 (여기서는 '쓰는 중'으로 치지 않는다)
            if path.startswith(("/api/", "/auth/")):
                return jsonify(error="잠겨 있어요. 잠금을 풀어 주세요.", locked=True), 401
            nxt = request.full_path if path == "/" and request.query_string else None
            return redirect(url_for("auth.unlock", next=nxt) if nxt else url_for("auth.unlock"))
        # 동기화 확인(/api/version)은 화면이 알아서 보내는 것이라 '쓰는 중'으로 치지 않는다.
        # 대신 그사이 사람이 화면을 만졌으면 X-Active 머리말을 붙여 보낸다 (sync.js)
        passkeys.touch(path != "/api/version" or request.headers.get("X-Active") == "1")
        return None
    if path == "/unlock":
        return redirect(url_for("auth.login"))
    if path.startswith(("/api/", "/auth/")):
        return jsonify(error="로그인이 필요해요."), 401
    # 보던 화면 주소(/?week=…)로 들어왔으면 로그인한 뒤 그 화면으로 돌아가게 기억해 둔다 (0.10.0)
    if path == "/" and request.query_string:
        return redirect(url_for("auth.login", next=request.full_path))
    return redirect(url_for("auth.login"))


def safe_next(value):
    """로그인 뒤에 돌아갈 주소: 이 앱의 첫 화면 주소(/?…)만 허용한다 (다른 사이트로 보내는 것 방지)"""
    if value and value.startswith("/?") and "//" not in value and "\\" not in value:
        return value
    return url_for("index")


# ---------------------------------------------------------------- 연속 실패 제한
def _client_ip():
    return request.remote_addr or "?"


def _locked_seconds_left(ip):
    fails, locked_at = _fails.get(ip, (0, 0))
    if fails < MAX_FAILS:
        return 0
    left = LOCK_SECONDS - (time.time() - locked_at)
    if left <= 0:
        _fails.pop(ip, None)
        return 0
    return int(left) + 1


def _record_fail(ip):
    fails, _ = _fails.get(ip, (0, 0))
    _fails[ip] = (fails + 1, time.time())


# ---------------------------------------------------------------- 화면
@bp.route("/login", methods=["GET", "POST"])
def login():
    if not login_required():
        return redirect(url_for("index"))
    if session.get("logged_in"):
        return redirect(url_for("index"))

    error = None
    status = 200
    if request.method == "POST":
        ip = _client_ip()
        wait = _locked_seconds_left(ip)
        if wait:
            error = f"여러 번 틀려서 잠시 막혔어요. {wait}초 뒤에 다시 시도해 주세요."
            status = 429
        elif check_password_hash(load_password_hash(current_app.config["DATA_DIR"]), request.form.get("password", "")):
            _fails.pop(ip, None)
            session.clear()
            session["logged_in"] = True
            session.permanent = True  # 브라우저를 닫아도 1년 동안 유지
            return redirect(safe_next(request.args.get("next")))
        else:
            _record_fail(ip)
            error = "비밀번호가 맞지 않아요."
            status = 401
    return render_template("login.html", error=error, mode="login", has_passkeys=passkeys.has_passkeys()), status


@bp.route("/unlock", methods=["GET", "POST"])
def unlock():
    """
    잠긴 화면: PIN(0.13.0), 패스키(Face ID·지문), 비밀번호 중 하나로 연다. 잠금 설정은 그대로 둔다.
    PIN을 여러 번(lock.MAX_PIN_FAILS) 틀리면 이 기기에서는 비밀번호나 패스키로만 열린다.
    """
    import lock

    if not passkeys.is_locked():
        return redirect(safe_next(request.args.get("next")))
    error = None
    status = 200
    if request.method == "POST":
        ip = _client_ip()
        wait = _locked_seconds_left(ip)
        pin = request.form.get("pin")
        if wait:
            error = f"여러 번 틀려서 잠시 막혔어요. {wait}초 뒤에 다시 시도해 주세요."
            status = 429
        elif pin is not None:
            if not lock.pin_allowed():
                error = "PIN을 여러 번 틀려서 비밀번호로만 열 수 있어요."
                status = 403
            elif lock.check_pin(pin):
                _fails.pop(ip, None)
                lock.unlocked()
                return redirect(safe_next(request.args.get("next")))
            else:
                _record_fail(ip)
                lock.pin_failed()
                left = lock.pin_tries_left()
                error = f"PIN이 맞지 않아요. ({left}번 더 틀리면 비밀번호로만 열려요)" if left else "PIN을 여러 번 틀려서 이제 비밀번호로만 열 수 있어요."
                status = 401
        elif check_password(request.form.get("password", "")):
            _fails.pop(ip, None)
            lock.unlocked()
            return redirect(safe_next(request.args.get("next")))
        else:
            _record_fail(ip)
            error = "비밀번호가 맞지 않아요."
            status = 401
    return render_template(
        "login.html", error=error, mode="unlock", has_passkeys=passkeys.has_passkeys(),
        pin=lock.has_pin() and lock.pin_allowed(), manual=bool(session.get("locked")),
        used_pin=request.form.get("pin") is not None,
    ), status


@bp.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
