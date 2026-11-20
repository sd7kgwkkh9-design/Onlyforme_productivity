"""
'나' — 메모장의 자기소개 탭 (0.14.2). api.py와 같은 /api 묶음(blueprint)에 붙는다.

  GET    /api/about                칸 목록 (순서대로)
  POST   /api/about                칸 더하기 {title, kind}            kind: fields | lists | text
  PUT    /api/about/<id>           칸 고치기 {title?, data?}          쓰는 대로 자동 저장
  DELETE /api/about/<id>           칸 지우기
  PUT    /api/about/order          순서 바꾸기 {ids: [..]}

칸의 종류와 data 모양
  fields : 이름: 내용 줄들        [{"label": "MBTI", "value": "INFJ"}, …]
  lists  : 분류마다 칩            [{"label": "운동", "items": ["수영", "러닝"]}, …]
  text   : 긴 글 하나             "아무거나"

나만 보는 내용이라 공유 링크·캘린더 구독(ICS)·홈 화면 위젯에는 절대 나가지 않는다 (links.py는 이 표를 읽지 않는다).
검색(search.py)과 백업(backup.py)에는 들어간다.
"""

import json

from flask import jsonify

from api import ApiError, bp, json_body
from db import get_db

KINDS = ("fields", "lists", "text")
MAX_SECTIONS = 30
MAX_TITLE = 30
MAX_ROWS = 40
MAX_LABEL = 30
MAX_VALUE = 200
MAX_ITEMS = 40
MAX_ITEM = 40
MAX_TEXT = 5000


def empty_data(kind):
    return "" if kind == "text" else []


def section_dict(row):
    try:
        data = json.loads(row["data"])
    except ValueError:
        data = empty_data(row["kind"])
    return {"id": row["id"], "title": row["title"], "kind": row["kind"], "data": data, "updated_at": row["updated_at"]}


def clean_title(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError("칸 이름을 적어 주세요.")
    value = " ".join(value.split())
    if len(value) > MAX_TITLE:
        raise ApiError(f"칸 이름은 {MAX_TITLE}자까지예요.")
    return value


def short(value, limit, what):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ApiError(f"{what}은(는) 글자로 보내 주세요.")
    value = value.strip()
    if len(value) > limit:
        raise ApiError(f"{what}은(는) {limit}자까지예요.")
    return value


def clean_data(kind, data):
    """칸 종류에 맞는 모양인지 보고, 앞뒤 빈칸을 다듬는다. 빈 줄도 남긴다 (적는 중일 수 있어서)."""
    if kind == "text":
        if not isinstance(data, str):
            raise ApiError("글은 글자로 보내 주세요.")
        if len(data) > MAX_TEXT:
            raise ApiError(f"글은 {MAX_TEXT}자까지예요.")
        return data
    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
        raise ApiError("내용 모양이 맞지 않아요.")
    if len(data) > MAX_ROWS:
        raise ApiError(f"한 칸에 {MAX_ROWS}줄까지 넣을 수 있어요.")
    out = []
    for r in data:
        label = short(r.get("label"), MAX_LABEL, "항목 이름")
        if kind == "fields":
            out.append({"label": label, "value": short(r.get("value"), MAX_VALUE, "내용")})
        else:
            items = r.get("items") or []
            if not isinstance(items, list) or len(items) > MAX_ITEMS:
                raise ApiError(f"한 줄에 {MAX_ITEMS}개까지 넣을 수 있어요.")
            seen, clean = set(), []
            for it in items:
                it = short(it, MAX_ITEM, "칩")
                if it and it not in seen:
                    seen.add(it)
                    clean.append(it)
            out.append({"label": label, "items": clean})
    return out


def get_or_404(db, section_id):
    row = db.execute("SELECT * FROM about_sections WHERE id = ?", (section_id,)).fetchone()
    if row is None:
        raise ApiError("그 칸을 찾을 수 없어요.", 404)
    return row


def about_list(db):
    return [section_dict(r) for r in db.execute("SELECT * FROM about_sections ORDER BY position, id")]


@bp.get("/about")
def list_about():
    return jsonify(about_list(get_db()))


@bp.post("/about")
def create_about():
    db = get_db()
    data = json_body()
    if db.execute("SELECT COUNT(*) AS n FROM about_sections").fetchone()["n"] >= MAX_SECTIONS:
        raise ApiError(f"칸은 {MAX_SECTIONS}개까지 만들 수 있어요.")
    kind = data.get("kind") or "lists"
    if kind not in KINDS:
        raise ApiError("칸 종류는 fields(항목), lists(칩 목록), text(글) 중 하나예요.")
    title = clean_title(data.get("title"))
    body = clean_data(kind, data["data"]) if "data" in data else empty_data(kind)
    pos = db.execute("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM about_sections").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO about_sections (title, kind, data, position) VALUES (?, ?, ?, ?)",
        (title, kind, json.dumps(body, ensure_ascii=False), pos),
    )
    db.commit()
    return jsonify(section_dict(get_or_404(db, cur.lastrowid))), 201


@bp.put("/about/order")
def order_about():
    db = get_db()
    ids = json_body().get("ids")
    have = [r["id"] for r in db.execute("SELECT id FROM about_sections")]
    if not isinstance(ids, list) or sorted(ids) != sorted(have):
        raise ApiError("순서 목록이 맞지 않아요. 새로 불러온 뒤 다시 해 주세요.", 409)
    for pos, sid in enumerate(ids):
        db.execute("UPDATE about_sections SET position = ? WHERE id = ?", (pos, sid))
    db.commit()
    return jsonify(about_list(db))


@bp.put("/about/<int:section_id>")
def update_about(section_id):
    db = get_db()
    row = get_or_404(db, section_id)
    data = json_body()
    fields = {}
    if "title" in data:
        fields["title"] = clean_title(data["title"])
    if "data" in data:
        fields["data"] = json.dumps(clean_data(row["kind"], data["data"]), ensure_ascii=False)
    if fields:
        db.execute(
            f"UPDATE about_sections SET {', '.join(f'{k} = ?' for k in fields)}, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (*fields.values(), section_id),
        )
        db.commit()
    return jsonify(section_dict(get_or_404(db, section_id)))


@bp.delete("/about/<int:section_id>")
def delete_about(section_id):
    db = get_db()
    get_or_404(db, section_id)
    db.execute("DELETE FROM about_sections WHERE id = ?", (section_id,))
    db.commit()
    return jsonify(deleted=section_id)


def about_text(row):
    """검색용: 칸 하나를 '라벨 내용 · 라벨 칩, 칩' 같은 평범한 글로"""
    d = section_dict(row)["data"]
    if isinstance(d, str):
        return d
    parts = []
    for r in d:
        body = r.get("value") if "value" in r else ", ".join(r.get("items", []))
        if body:
            parts.append(f"{r.get('label', '')} {body}".strip())
    return " · ".join(parts)
