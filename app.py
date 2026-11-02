"""
나의 캘린더 — 실행 파일

    python app.py                 # http://127.0.0.1:8000 에서 실행
    python app.py --host 0.0.0.0  # 같은 와이파이의 휴대폰에서도 접속 가능

(맥에서는 5000번 포트를 AirPlay가 쓰는 경우가 많아서 기본 포트를 8000으로 정했다.)
"""

import argparse
import mimetypes
import os

from flask import Flask, render_template, request

import db
from api import bp as api_bp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 홈 화면 설치용 manifest 파일의 형식을 브라우저에 올바르게 알려 준다.
mimetypes.add_type("application/manifest+json", ".webmanifest")


def create_app(database_path=None):
    """
    앱 팩토리: 테스트에서는 임시 DB 경로를 넘겨서 실제 데이터와 분리한다.
    DB 경로 우선순위: 인자 → 환경변수 CALENDAR_DB → instance/calendar.db
    """
    app = Flask(__name__)
    app.json.ensure_ascii = False  # 응답 JSON의 한글을 그대로 보이게

    if database_path is None:
        database_path = os.environ.get("CALENDAR_DB") or os.path.join(
            BASE_DIR, "instance", "calendar.db"
        )
    folder = os.path.dirname(os.path.abspath(database_path))
    os.makedirs(folder, exist_ok=True)
    app.config["DATABASE"] = database_path

    db.init_db(database_path)
    app.teardown_appcontext(db.close_db)
    app.register_blueprint(api_bp)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.after_request
    def revalidate_static(response):
        # 코드를 새 버전으로 바꿨는데 브라우저가 예전 JS/CSS를 계속 쓰는 일을 막는다.
        # no-cache = "쓰기 전에 바뀌었는지 서버에 물어보기". 안 바뀌었으면 304로 바로 끝나서 느려지지 않는다.
        if request.path == "/" or request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    return app


def main():
    parser = argparse.ArgumentParser(description="나의 캘린더 실행")
    parser.add_argument("--host", default="127.0.0.1", help="기본값 127.0.0.1 (내 컴퓨터만)")
    parser.add_argument("--port", type=int, default=8000, help="기본값 8000")
    parser.add_argument("--debug", action="store_true", help="코드 수정 시 자동 재시작")
    args = parser.parse_args()

    app = create_app()
    print(f"\n  나의 캘린더: http://localhost:{args.port}")
    if args.host == "0.0.0.0":
        print(f"  휴대폰에서는 http://<이 컴퓨터의 IP 주소>:{args.port} 로 접속하세요.")
    print()
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
