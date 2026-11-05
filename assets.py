"""
화면 파일(JS·CSS·글꼴)과 응답을 빠르게 보내기 위한 장치 (최적화)

1) 지문 붙은 주소 + 오래 저장
   파일 내용으로 짧은 지문(해시)을 만들어 주소 뒤에 붙인다:  css/style.css?v=3f9a1c2e07
   → 브라우저는 이 주소의 파일을 1년 동안 서버에 다시 묻지 않고 바로 쓴다.
   → 파일 내용이 바뀌면 지문이 바뀌어 주소가 달라지므로, 새 버전을 올리면 자동으로 새 파일을 받는다.
     (4차 때처럼 '서버에는 새 버전, 브라우저에는 옛 파일'이 섞이는 일이 생기지 않는다)
   JS 모듈 안의 import './api.js'에는 지문을 직접 붙일 수 없어서,
   index.html의 import map이 './api.js' → './api.js?v=…' 로 바꿔 준다 (module_map).

2) 압축
   글자로 된 응답(HTML·CSS·JS·JSON)은 gzip으로 압축해서 보낸다. 보통 1/3~1/5 크기가 된다.
   정적 파일은 한 번 압축한 결과를 기억해 두고 다시 쓴다.

라이브러리 없이 파이썬 표준 모듈(gzip, hashlib)만 쓴다.
"""

import gzip
import hashlib
import os

from flask import request, url_for

TEXT_TYPES = {
    "text/html", "text/css", "text/plain", "text/javascript", "application/javascript",
    "application/json", "application/manifest+json", "image/svg+xml",
}
MIN_COMPRESS = 1024                      # 이보다 작은 응답은 압축해도 이득이 거의 없다
LONG_CACHE = "public, max-age=31536000, immutable"   # 지문 붙은 주소: 1년
FONT_CACHE = "public, max-age=2592000"   # 글꼴 파일(바뀌지 않는 오픈소스 배포본): 30일


class Assets:
    def __init__(self, app):
        self.static_dir = app.static_folder
        self._digests = {}   # 파일 → (수정 시각, 지문)
        self._gzipped = {}   # (주소, ETag) → 압축한 내용
        app.jinja_env.globals["asset_url"] = self.url
        app.jinja_env.globals["module_map"] = self.module_map

    # ------------------------------------------------------------ 지문 붙은 주소
    def digest(self, filename):
        path = os.path.join(self.static_dir, filename)
        mtime = os.path.getmtime(path)
        cached = self._digests.get(filename)
        if cached and cached[0] == mtime:
            return cached[1]
        with open(path, "rb") as f:
            value = hashlib.sha1(f.read()).hexdigest()[:10]
        self._digests[filename] = (mtime, value)
        return value

    def url(self, filename):
        """템플릿에서 {{ asset_url('css/style.css') }} → /static/css/style.css?v=…"""
        return url_for("static", filename=filename, v=self.digest(filename))

    def module_map(self):
        """static/js의 모든 모듈 {원래 주소: 지문 붙은 주소} — index.html의 import map과 미리 불러오기에 쓴다."""
        js_dir = os.path.join(self.static_dir, "js")
        return {
            url_for("static", filename=f"js/{name}"): self.url(f"js/{name}")
            for name in sorted(os.listdir(js_dir))
            if name.endswith(".js")
        }

    # ------------------------------------------------------------ 응답 마무리
    def finish(self, response):
        """app.py의 after_request 마지막에 부른다: 저장 기간 정하기 → 압축"""
        self.cache_headers(response)
        self.compress(response)
        return response

    def cache_headers(self, response):
        path = request.path
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"     # 동기화가 늘 최신 값을 보도록
        elif path.startswith("/static/") and request.args.get("v"):
            response.headers["Cache-Control"] = LONG_CACHE
        elif path.startswith("/static/") and path.endswith(".woff2"):
            response.headers["Cache-Control"] = FONT_CACHE
        elif path == "/" or path.startswith("/static/"):
            # 지문이 없는 주소(첫 화면, 아이콘 등): 쓰기 전에 바뀌었는지 서버에 물어보기
            response.headers["Cache-Control"] = "no-cache"

    def compress(self, response):
        if (
            request.method == "HEAD"
            or response.status_code != 200
            or "gzip" not in request.headers.get("Accept-Encoding", "")
            or "Content-Encoding" in response.headers
            or response.mimetype not in TEXT_TYPES
        ):
            return
        response.vary.add("Accept-Encoding")

        if request.path.startswith("/static/") and response.direct_passthrough:
            # 정적 파일: 같은 파일(ETag가 같으면)은 한 번만 압축하고 기억해 둔다
            key = (request.path, response.headers.get("ETag"))
            data = self._gzipped.get(key)
            original = response.response
            if data is None:
                response.direct_passthrough = False
                raw = response.get_data()
                if len(raw) < MIN_COMPRESS:
                    return
                data = gzip.compress(raw, 6)
                self._gzipped[key] = data
            elif hasattr(original, "close"):
                original.close()  # 기억해 둔 것을 쓰므로 열어 둔 파일은 닫는다
            response.direct_passthrough = False
        else:
            raw = response.get_data()
            if len(raw) < MIN_COMPRESS:
                return
            data = gzip.compress(raw, 6)

        response.set_data(data)
        response.headers["Content-Encoding"] = "gzip"
