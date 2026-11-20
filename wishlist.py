"""
살 것 — 메모장의 구매 예정 목록 (0.14.2). api.py와 같은 /api 묶음(blueprint)에 붙는다.

  GET    /api/wishlist            목록 (⭐ 꼭 살 것 먼저, 그다음 넣은 순서) + 합계
  POST   /api/wishlist            더하기 {title, price?, url?, starred?, when?}
  PUT    /api/wishlist/<id>       고치기 (보낸 칸만)
  DELETE /api/wishlist/<id>       빼기 (샀거나 마음이 바뀌었을 때)

- price: 원 단위 정수, 모르면 null. 합계는 가격을 적은 것만 더한다.
- url  : 상품 페이지 주소. http(s)만 받는다 (javascript: 같은 주소로 스크립트가 실행되지 않게).
- when : '12월', '세일하면'처럼 언제쯤 살지 짧은 말.
나만 보는 목록이라 공유 링크·캘린더 구독·위젯에는 나가지 않는다. 검색·백업에는 들어간다.
"""

import re
from urllib.parse import urlparse

from flask import jsonify

from api import ApiError, bp, json_body
from db import get_db

MAX_ITEMS = 200
MAX_TITLE = 60
MAX_WHEN = 20
MAX_URL = 500
MAX_PRICE = 10_000_000_000   # 100억


def wish_dict(r):
    return {"id": r["id"], "title": r["title"], "price": r["price"], "url": r["url"], "starred": bool(r["starred"]),
            "when": r["when_text"], "created_at": r["created_at"]}


def wish_list(db):
    rows = db.execute("SELECT * FROM wishlist ORDER BY starred DESC, position, id").fetchall()
    items = [wish_dict(r) for r in rows]
    priced = [i["price"] for i in items if i["price"] is not None]
    starred = [i["price"] for i in items if i["starred"] and i["price"] is not None]
    return {
        "items": items,
        "total": sum(priced),
        "priced": len(priced),
        "starred_total": sum(starred),
        "starred_count": sum(1 for i in items if i["starred"]),
    }


def clean_url(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ApiError("링크는 글자로 보내 주세요.")
    value = value.strip()
    if not value:
        return ""
    if len(value) > MAX_URL:
        raise ApiError(f"링크는 {MAX_URL}자까지예요.")
    if re.match(r"^[a-z][a-z0-9+-]*:", value, re.IGNORECASE) and not re.match(r"^https?://", value, re.IGNORECASE):
        raise ApiError("링크는 http:// 또는 https:// 로 시작하는 주소로 적어 주세요.")   # javascript: 같은 것
    if not re.match(r"^https?://", value, re.IGNORECASE):
        value = "https://" + value
    p = urlparse(value)
    try:
        p.port  # noqa: B018  'a.com:abc'처럼 이상한 포트는 여기서 ValueError
    except ValueError:
        raise ApiError("링크 주소를 확인해 주세요.") from None
    if p.scheme.lower() not in ("http", "https") or not p.hostname or " " in value:
        raise ApiError("링크는 http:// 또는 https:// 로 시작하는 주소로 적어 주세요.")
    return value


def clean_price(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_PRICE:
        raise ApiError("가격은 0 이상의 숫자(원)로 적어 주세요.")
    return value


def payload(data, existing=None):
    out = {}
    if existing is None or "title" in data:
        title = data.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ApiError("무엇을 살지 적어 주세요.")
        title = " ".join(title.split())
        if len(title) > MAX_TITLE:
            raise ApiError(f"이름은 {MAX_TITLE}자까지예요.")
        out["title"] = title
    if "price" in data or existing is None:
        out["price"] = clean_price(data.get("price"))
    if "url" in data or existing is None:
        out["url"] = clean_url(data.get("url"))
    if "starred" in data or existing is None:
        starred = data.get("starred", False)
        if not isinstance(starred, bool):
            raise ApiError("starred는 true/false여야 해요.")
        out["starred"] = int(starred)
    if "when" in data or existing is None:
        when = data.get("when") or ""
        if not isinstance(when, str) or len(when.strip()) > MAX_WHEN:
            raise ApiError(f"언제쯤은 {MAX_WHEN}자까지예요.")
        out["when_text"] = when.strip()
    return out


def get_or_404(db, wish_id):
    row = db.execute("SELECT * FROM wishlist WHERE id = ?", (wish_id,)).fetchone()
    if row is None:
        raise ApiError("그 항목을 찾을 수 없어요.", 404)
    return row


@bp.get("/wishlist")
def list_wishlist():
    return jsonify(wish_list(get_db()))


@bp.post("/wishlist")
def create_wish():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM wishlist").fetchone()["n"] >= MAX_ITEMS:
        raise ApiError(f"살 것은 {MAX_ITEMS}개까지 적을 수 있어요.")
    f = payload(json_body())
    pos = db.execute("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM wishlist").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO wishlist (title, price, url, starred, when_text, position) VALUES (?, ?, ?, ?, ?, ?)",
        (f["title"], f["price"], f["url"], f["starred"], f["when_text"], pos),
    )
    db.commit()
    return jsonify(wish_dict(get_or_404(db, cur.lastrowid))), 201


@bp.put("/wishlist/<int:wish_id>")
def update_wish(wish_id):
    db = get_db()
    row = get_or_404(db, wish_id)
    f = payload(json_body(), existing=row)
    if f:
        db.execute(f"UPDATE wishlist SET {', '.join(f'{k} = ?' for k in f)} WHERE id = ?", (*f.values(), wish_id))
        db.commit()
    return jsonify(wish_dict(get_or_404(db, wish_id)))


@bp.delete("/wishlist/<int:wish_id>")
def delete_wish(wish_id):
    db = get_db()
    get_or_404(db, wish_id)
    db.execute("DELETE FROM wishlist WHERE id = ?", (wish_id,))
    db.commit()
    return jsonify(deleted=wish_id)
