"""
패스키 로그인과 '열 때마다 생체 인증' (0.12.0)

패스키(WebAuthn)는 웹사이트용 표준이라 앱이 아니어도 브라우저가 Face ID·Touch ID·지문·Windows Hello를 띄워 준다.
- 기기 안에서 만든 열쇠 쌍 중 '공개 키'만 서버(passkeys 표)에 저장한다. 비밀 키는 기기 밖으로 나오지 않는다.
- 로그인할 때 서버가 낸 무작위 문제(challenge)에 기기가 비밀 키로 서명하고, 서버는 공개 키로 확인한다.
- 아이클라우드 키체인을 쓰면 아이폰에서 등록한 패스키가 맥에도 따라온다.
- 비밀번호 로그인은 그대로 남는다 (패스키를 못 쓰는 기기, 남의 컴퓨터).
- 서명 검사는 오픈소스 py_webauthn(BSD-3-Clause)이 한다.

'열 때마다 생체 인증' (기기마다 따로, ⚙ 설정)
- 켜 두면 그 기기에서 몇 분(LOCK_IDLE) 넘게 안 쓰다가 다시 열 때 Face ID·지문을 한 번 더 확인한다.
- 로그인 쿠키(세션)에 '잠금 켬'과 '마지막으로 쓴 때'를 적어 두고 서버가 검사한다 (auth.py의 require_login).
  화면만 가리는 게 아니라, 잠긴 동안에는 API도 일정을 돌려주지 않는다.
- 잠긴 화면에서는 패스키 또는 비밀번호로 연다.

주소 (모두 POST는 JSON)
  GET    /auth/passkey/list               등록한 패스키 목록 + 이 기기의 잠금 상태          (로그인 필요)
  POST   /auth/passkey/register/options   새 패스키 등록 준비                                (로그인 필요)
  POST   /auth/passkey/register/verify    등록 마무리 {credential, label}                    (로그인 필요)
  DELETE /auth/passkey/<id>               패스키 지우기                                      (로그인 필요)
  POST   /auth/passkey/options            확인 준비 {purpose: login | unlock | lock}
  POST   /auth/passkey/verify             확인 {purpose, credential}
                                           login  → 로그인 (1년 유지)
                                           unlock → 잠긴 화면 열기
                                           lock   → 이 기기에서 '열 때마다 생체 인증' 켜기
  POST   /auth/passkey/lock               {on: false} → 이 기기의 잠금 끄기                  (로그인 필요)
"""

import json
import re
import time

from flask import Blueprint, current_app, jsonify, request, session

from db import get_db

bp = Blueprint("passkey", __name__, url_prefix="/auth/passkey")

USER_ID = b"onlyforme-owner"      # 이 앱은 한 사람만 쓰므로 사용자 번호는 하나
CHALLENGE_SECONDS = 300           # 등록·확인 준비 후 이 시간 안에 마쳐야 한다
MAX_PASSKEYS = 10
LOCK_IDLE = 5 * 60                # '열 때마다 생체 인증': 이만큼 안 쓰면 잠긴다 (초)
PURPOSES = ("login", "unlock", "lock")


def now():
    """지금 시각(초). 테스트에서 시간을 앞으로 돌려 볼 수 있게 함수로 둔다."""
    return time.time()


class PasskeyError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@bp.errorhandler(PasskeyError)
def handle_error(err):
    return jsonify(error=err.message), err.status


def lib():
    """py_webauthn은 패스키를 쓸 때만 불러온다 (설치 안 된 서버에서도 나머지 기능은 돈다)"""
    try:
        import webauthn
        from webauthn.helpers import structs
    except ImportError:
        raise PasskeyError("서버에 webauthn 패키지가 없어요. pip install -r requirements.txt 를 실행해 주세요.", 503) from None
    return webauthn, structs


def rp_id():
    """패스키가 묶이는 주소 (포트 빼고). 예: onlyforme.pythonanywhere.com, localhost"""
    return request.host.split(":")[0]


def origin():
    return request.host_url.rstrip("/")


def logged_in():
    return bool(session.get("logged_in"))


def need_login():
    if not logged_in():
        raise PasskeyError("로그인이 필요해요.", 401)


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise PasskeyError("요청 형식이 올바르지 않아요.")
    return data


def guess_label():
    """등록하는 기기 이름 짐작 (User-Agent). 나중에 목록에서 알아보기 위한 것"""
    ua = request.headers.get("User-Agent", "")
    for pattern, name in (
        (r"iPhone", "iPhone"), (r"iPad", "iPad"), (r"Android", "Android"),
        (r"Macintosh|Mac OS X", "Mac"), (r"Windows", "Windows PC"), (r"CrOS", "Chromebook"), (r"Linux", "Linux PC"),
    ):
        if re.search(pattern, ua):
            device = name
            break
    else:
        device = "이 기기"
    browser = "Safari"
    for pattern, name in ((r"Edg/", "Edge"), (r"CriOS|Chrome/", "Chrome"), (r"FxiOS|Firefox/", "Firefox")):
        if re.search(pattern, ua):
            browser = name
            break
    return f"{device} · {browser}"


def rows():
    return get_db().execute("SELECT * FROM passkeys ORDER BY id").fetchall()


def has_passkeys():
    try:
        return get_db().execute("SELECT 1 FROM passkeys LIMIT 1").fetchone() is not None
    except Exception:  # 표가 아직 없는 아주 예전 데이터 파일
        return False


def save_challenge(challenge, purpose):
    from webauthn.helpers import bytes_to_base64url
    session["pk_challenge"] = {"value": bytes_to_base64url(challenge), "purpose": purpose, "at": now()}


def take_challenge(purpose):
    from webauthn.helpers import base64url_to_bytes
    saved = session.pop("pk_challenge", None)
    if not saved or saved.get("purpose") != purpose or now() - saved.get("at", 0) > CHALLENGE_SECONDS:
        raise PasskeyError("확인 시간이 지났어요. 다시 시도해 주세요.")
    return base64url_to_bytes(saved["value"])


# ======================================================================== 목록·등록·삭제 (로그인 필요)
@bp.get("/list")
def list_passkeys():
    need_login()
    return jsonify(
        passkeys=[
            {"id": r["id"], "label": r["label"], "created_at": r["created_at"], "last_used_at": r["last_used_at"]}
            for r in rows()
        ],
        lock=bool(session.get("bio_lock")),
        lock_minutes=LOCK_IDLE // 60,
    )


@bp.post("/register/options")
def register_options():
    need_login()
    webauthn, structs = lib()
    from webauthn.helpers import base64url_to_bytes

    if len(rows()) >= MAX_PASSKEYS:
        raise PasskeyError(f"패스키는 {MAX_PASSKEYS}개까지 등록할 수 있어요. 안 쓰는 것을 지워 주세요.")
    options = webauthn.generate_registration_options(
        rp_id=rp_id(),
        rp_name=current_app.config.get("APP_NAME", "Onlyforme"),
        user_id=USER_ID,
        user_name=current_app.config.get("APP_SHORT_NAME", "Onlyforme"),
        user_display_name=current_app.config.get("APP_NAME", "Onlyforme"),
        authenticator_selection=structs.AuthenticatorSelectionCriteria(
            resident_key=structs.ResidentKeyRequirement.REQUIRED,          # 아이디 없이 패스키만 골라 로그인할 수 있게
            user_verification=structs.UserVerificationRequirement.REQUIRED,  # Face ID·지문·기기 암호로 '본인 확인'까지
        ),
        # 이 기기에 이미 등록한 패스키가 있으면 또 만들지 않게
        exclude_credentials=[
            structs.PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["credential_id"])) for r in rows()
        ],
    )
    save_challenge(options.challenge, "register")
    return current_app.response_class(webauthn.options_to_json(options), mimetype="application/json")


@bp.post("/register/verify")
def register_verify():
    need_login()
    webauthn, _ = lib()
    from webauthn.helpers import bytes_to_base64url

    data = body()
    challenge = take_challenge("register")
    try:
        verified = webauthn.verify_registration_response(
            credential=data.get("credential"),
            expected_challenge=challenge,
            expected_rp_id=rp_id(),
            expected_origin=origin(),
            require_user_verification=True,
        )
    except Exception as e:  # 형식이 틀렸거나 서명이 맞지 않음
        current_app.logger.info("passkey register failed: %s", e)
        raise PasskeyError("패스키를 확인하지 못했어요. 다시 시도해 주세요.") from None
    transports = (data.get("credential") or {}).get("response", {}).get("transports") or []
    label = str(data.get("label") or "").strip()[:30] or guess_label()
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO passkeys (credential_id, public_key, sign_count, label, transports) VALUES (?, ?, ?, ?, ?)",
        (bytes_to_base64url(verified.credential_id), verified.credential_public_key, verified.sign_count, label, json.dumps(transports)),
    )
    db.commit()
    return jsonify(ok=True, label=label), 201


@bp.delete("/<int:passkey_id>")
def delete_passkey(passkey_id):
    need_login()
    db = get_db()
    if db.execute("DELETE FROM passkeys WHERE id = ?", (passkey_id,)).rowcount == 0:
        raise PasskeyError("패스키를 찾을 수 없어요.", 404)
    db.commit()
    if not rows():
        session.pop("bio_lock", None)   # 패스키가 하나도 없으면 잠금도 풀어 둔다 (못 여는 일이 없게)
    return jsonify(deleted=passkey_id)


@bp.post("/lock")
def set_lock():
    """이 기기의 잠금 끄기. (켜기는 패스키 확인을 거쳐야 해서 /verify의 purpose=lock)"""
    need_login()
    if body().get("on"):
        raise PasskeyError("잠금을 켜려면 패스키로 한 번 확인해 주세요.")
    session.pop("bio_lock", None)
    return jsonify(lock=False)


# ======================================================================== 확인 (로그인·잠금 열기·잠금 켜기)
@bp.post("/options")
def auth_options():
    webauthn, structs = lib()
    from webauthn.helpers import base64url_to_bytes

    purpose = body().get("purpose")
    if purpose not in PURPOSES:
        raise PasskeyError("purpose는 login, unlock, lock 중 하나예요.")
    if purpose != "login":
        need_login()
    saved = rows()
    if not saved:
        raise PasskeyError("등록한 패스키가 없어요. 비밀번호로 들어간 뒤 ⚙ 설정에서 등록해 주세요.", 404)
    options = webauthn.generate_authentication_options(
        rp_id=rp_id(),
        allow_credentials=[
            structs.PublicKeyCredentialDescriptor(
                id=base64url_to_bytes(r["credential_id"]),
                transports=[structs.AuthenticatorTransport(t) for t in json.loads(r["transports"] or "[]")
                            if t in {x.value for x in structs.AuthenticatorTransport}],
            )
            for r in saved
        ],
        user_verification=structs.UserVerificationRequirement.REQUIRED,
    )
    save_challenge(options.challenge, purpose)
    return current_app.response_class(webauthn.options_to_json(options), mimetype="application/json")


@bp.post("/verify")
def auth_verify():
    import auth  # 연속 실패 제한을 비밀번호 로그인과 같이 쓴다
    webauthn, _ = lib()

    data = body()
    purpose = data.get("purpose")
    if purpose not in PURPOSES:
        raise PasskeyError("purpose는 login, unlock, lock 중 하나예요.")
    if purpose != "login":
        need_login()
    ip = auth._client_ip()
    wait = auth._locked_seconds_left(ip)
    if wait:
        raise PasskeyError(f"여러 번 실패해서 잠시 막혔어요. {wait}초 뒤에 다시 시도해 주세요.", 429)

    challenge = take_challenge(purpose)
    credential = data.get("credential") or {}
    db = get_db()
    row = db.execute("SELECT * FROM passkeys WHERE credential_id = ?", (str(credential.get("id") or ""),)).fetchone()
    if row is None:
        auth._record_fail(ip)
        raise PasskeyError("등록되지 않은 패스키예요. 지웠거나 다른 주소에서 만든 패스키일 수 있어요.", 401)
    try:
        verified = webauthn.verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id(),
            expected_origin=origin(),
            credential_public_key=row["public_key"],
            credential_current_sign_count=row["sign_count"],
            require_user_verification=True,
        )
    except Exception as e:
        current_app.logger.info("passkey verify failed: %s", e)
        auth._record_fail(ip)
        raise PasskeyError("패스키를 확인하지 못했어요. 다시 시도해 주세요.", 401) from None

    auth._fails.pop(ip, None)
    db.execute(
        "UPDATE passkeys SET sign_count = ?, last_used_at = datetime('now', 'localtime') WHERE id = ?",
        (verified.new_sign_count, row["id"]),
    )
    db.commit()

    if purpose == "login":
        session.clear()
        session["logged_in"] = True
        session.permanent = True        # 1년 유지 (비밀번호 로그인과 같다)
        session["seen"] = now()
    elif purpose == "unlock":
        session["seen"] = now()
    else:  # lock
        session["bio_lock"] = True
        session["seen"] = now()
    return jsonify(ok=True, purpose=purpose, lock=bool(session.get("bio_lock")))


# ======================================================================== 잠금 검사 (auth.py의 require_login이 부른다)
def is_locked():
    """이 기기에서 잠금을 켜 두었고, 마지막으로 쓴 지 LOCK_IDLE이 넘었으면 잠긴 상태"""
    return bool(session.get("bio_lock")) and now() - float(session.get("seen") or 0) > LOCK_IDLE


def touch(active=True):
    """이 기기에서 지금 쓰고 있다고 적어 둔다 (30초에 한 번만 — 쿠키를 매번 새로 쓰지 않게)"""
    if active and session.get("bio_lock") and now() - float(session.get("seen") or 0) > 30:
        session["seen"] = now()
