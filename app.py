"""
오직 나를 위한 캘린더 — 실행 파일

내 컴퓨터에서 실행:
    python app.py                 # http://127.0.0.1:8000 에서 실행
    python app.py --host 0.0.0.0  # 같은 와이파이의 휴대폰에서도 접속 가능
    python app.py --set-password  # 로그인 비밀번호 정하기/바꾸기
    python app.py --demo          # 예시 일정이 채워진 시연용 캘린더 (실제 데이터와 분리)

인터넷 서버(PythonAnywhere 등)에서는 wsgi.py가 이 파일의 create_app()을 불러 쓴다.

(맥에서는 5000번 포트를 AirPlay가 쓰는 경우가 많아서 기본 포트를 8000으로 정했다.)
"""

import argparse
import getpass
import mimetypes
import os
import sys

from flask import Flask, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

import api_tools  # noqa: F401  루틴·루틴 기록·기록지·D-day·시간 돌아보기·빠른 입력 주소를 같은 /api 묶음에 등록
import auth
import db
import demo
from api import bp as api_bp
from assets import Assets

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 앱 이름 (화면 곳곳에 쓰인다. 홈 화면 아이콘 아래 이름은 static/manifest.webmanifest에도 있다)
APP_NAME = "오직 나를 위한 캘린더"
APP_SHORT_NAME = "Onlyforme"   # 휴대폰 홈 화면 아이콘 아래 이름 (긴 이름은 잘려서 짧게)

# 버전 (유의적 버전 MAJOR.MINOR.PATCH) — ⚙ 설정 메뉴 맨 아래에 보인다.
# 새 기능을 넣으면 가운데 숫자(0.9.0 → 0.10.0), 고치기만 했으면 끝 숫자(0.9.0 → 0.9.1)를 올린다.
APP_VERSION = "0.11.0"

# 홈 화면 설치용 manifest 파일의 형식을 브라우저에 올바르게 알려 준다.
mimetypes.add_type("application/manifest+json", ".webmanifest")


def default_database_path():
    return os.environ.get("CALENDAR_DB") or os.path.join(BASE_DIR, "instance", "calendar.db")


def create_app(database_path=None, production=False, demo_mode=False):
    """
    앱 팩토리.
      database_path : 일정 데이터 파일. 테스트에서는 임시 경로를 넘겨 실제 데이터와 분리한다.
                      (우선순위: 인자 → 환경변수 CALENDAR_DB → instance/calendar.db)
      production    : 인터넷 서버용이면 True. 비밀번호가 없으면 열리지 않고, 쿠키는 https 전용.
    비밀번호(auth.json)와 쿠키 서명 키(secret_key)는 데이터 파일과 같은 폴더에 저장된다.
    """
    app = Flask(__name__)
    app.json.ensure_ascii = False  # 응답 JSON의 한글을 그대로 보이게

    database_path = database_path or default_database_path()
    data_dir = os.path.dirname(os.path.abspath(database_path))
    os.makedirs(data_dir, exist_ok=True)
    app.config["DATABASE"] = database_path
    app.config["DEMO"] = demo_mode

    if production:
        # 서버 앞단(프록시)을 거쳐 들어오므로, 실제 접속한 기기의 IP와 https 여부를 헤더에서 읽는다.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    db.init_db(database_path)
    app.teardown_appcontext(db.close_db)
    assets = Assets(app)  # 지문 붙은 주소(오래 저장) + 압축 — assets.py
    auth.init_auth(app, data_dir, production)
    app.register_blueprint(api_bp)

    @app.context_processor
    def app_names():
        # 모든 템플릿에서 {{ app_name }} 등으로 쓸 수 있게
        return {"app_name": APP_NAME, "app_short_name": APP_SHORT_NAME, "app_version": APP_VERSION}

    @app.get("/")
    def index():
        return render_template("index.html", login_enabled=auth.login_required(), demo=app.config["DEMO"])

    @app.after_request
    def after(response):
        # 1) 일정·카테고리가 바뀌면 변경 번호를 올린다 → 다른 기기가 알아채고 새로 불러온다.
        if (
            request.path.startswith("/api/")
            and request.method in ("POST", "PUT", "DELETE")
            and response.status_code < 400
        ):
            db.bump_version(db.get_db())
            # 이 저장으로 몇 번이 됐는지 알려 준다 → 화면이 '내가 바꾼 것만 있었는지'를 정확히 판단 (sync.js)
            response.headers["X-Data-Version"] = str(db.current_version(db.get_db()))

        # 2) 저장 기간 정하기 + 압축 (assets.py)
        #    지문 붙은 JS/CSS는 1년 저장, 첫 화면은 매번 확인(no-cache), API는 저장 안 함(no-store)
        return assets.finish(response)

    return app


def set_password_interactive(database_path=None):
    data_dir = os.path.dirname(os.path.abspath(database_path or default_database_path()))
    print("로그인 비밀번호를 정해요. (입력해도 화면에 보이지 않는 게 정상이에요)")
    first = getpass.getpass("새 비밀번호: ")
    second = getpass.getpass("한 번 더: ")
    if first != second:
        print("두 비밀번호가 달라요. 다시 실행해 주세요.")
        return 1
    try:
        auth.save_password(data_dir, first)
    except ValueError as e:
        print(e)
        return 1
    print(f"저장했어요. ({os.path.join(data_dir, 'auth.json')})")
    print("인터넷 서버라면 Web 탭에서 Reload를 눌러 주세요. 이미 로그인한 기기는 그대로 유지돼요.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=f"{APP_NAME} 실행")
    parser.add_argument("--host", default="127.0.0.1", help="기본값 127.0.0.1 (내 컴퓨터만)")
    parser.add_argument("--port", type=int, default=8000, help="기본값 8000")
    parser.add_argument("--debug", action="store_true", help="코드 수정 시 자동 재시작")
    parser.add_argument("--set-password", action="store_true", help="로그인 비밀번호 정하기/바꾸기")
    parser.add_argument("--demo", action="store_true", help="예시 일정이 채워진 시연용 캘린더로 실행")
    args = parser.parse_args()

    if args.set_password:
        sys.exit(set_password_interactive())

    if args.demo:
        demo.reset_demo_folder(BASE_DIR)  # 실행할 때마다 처음 상태로
        app = create_app(demo.demo_database_path(BASE_DIR), demo_mode=True)
        demo.seed_demo(app)
        print("\n  [시연용] 예시 일정이 들어 있는 캘린더예요. 실제 데이터(instance/calendar.db)와는 분리되어 있어요.")
    else:
        app = create_app()
    print(f"\n  {APP_NAME} {APP_VERSION}: http://localhost:{args.port}")
    if args.host == "0.0.0.0":
        print(f"  휴대폰에서는 http://<이 컴퓨터의 IP 주소>:{args.port} 로 접속하세요.")
    print()
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
