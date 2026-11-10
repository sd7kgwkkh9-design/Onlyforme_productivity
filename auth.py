"""
로그인 — 비밀번호 하나로 나만 쓰는 캘린더 지키기

비밀번호 정하기 (처음 한 번, 서버에서):
    python app.py --set-password

- 비밀번호는 그대로 저장하지 않고 '해시'(되돌릴 수 없게 바꾼 값)로만 instance/auth.json에 저장한다.
- 로그인하면 기기마다 1년 동안 유지된다 (쿠키 세션).
- 비밀번호를 연달아 틀리면 잠시 로그인을 막는다 (무작위 대입 공격 방지).

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
    Blueprint, current_app, jsonify, redirect, render_template, request, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

bp = Blueprint("auth", __name__)

MAX_FAILS = 5            # 이만큼 연달아 틀리면
LOCK_SECONDS = 60        # 이 시간 동안 로그인 막기
MIN_PASSWORD_LENGTH = 4

_fails = {}  # IP 주소 → (연속 실패 횟수, 막힌 시각)


# ---------------------------------------------------------------- 파일 저장
def _auth_file(data_dir):
    return os.path.join(data_dir, "auth.json")


def load_password_hash(data_dir):
    try:
        with open(_auth_file(data_dir), encoding="utf-8") as f:
            return json.load(f).get("password_hash")
    except (FileNotFoundError, ValueError):
        return None


def save_password(data_dir, password):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 해요.")
    os.makedirs(data_dir, exist_ok=True)
    with open(_auth_file(data_dir), "w", encoding="utf-8") as f:
        json.dump({"password_hash": generate_password_hash(password)}, f)


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


def require_login():
    path = request.path
    if path.startswith("/static/") or path in ("/login", "/logout"):
        return None

    if not login_required():
        if current_app.config["PRODUCTION"]:
            # 인터넷 서버인데 비밀번호가 없으면 열지 않는다.
            if path.startswith("/api/"):
                return jsonify(error="비밀번호가 아직 설정되지 않았어요."), 503
            return render_template("setup_needed.html"), 503
        return None

    if session.get("logged_in"):
        return None
    if path.startswith("/api/"):
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
    return render_template("login.html", error=error), status


@bp.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
