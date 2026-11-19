// 오직 나를 위한 캘린더 — 아이폰 홈 화면·잠금 화면 위젯 (Scriptable 스크립트, 0.12.0 · 0.13.0에서 다음 수업을 더함)
//
// 쓰는 방법
//   1. App Store에서 무료 앱 'Scriptable'을 설치한다.
//   2. 캘린더의 ⚙ 설정 → 공유 링크·캘린더 구독·위젯 → 홈 화면 위젯에서 '스크립트 복사'.
//   3. Scriptable에서 + 를 누르고 붙여 넣는다. 이름을 Onlyforme로 바꾼다. ▶︎로 미리 볼 수 있다.
//   4. 홈 화면 편집 → 위젯 추가 → Scriptable → 크기 고르기 → 위젯을 길게 눌러 Script에서 Onlyforme 고르기.
//
// 크기마다 보이는 것
//   작게   : 날짜, 다음 일정, 오늘 일정 수, 가장 가까운 D-day, 올해 진행률
//   중간   : 왼쪽 오늘 일정(4개), 오른쪽 D-day와 올해 목표 진행도
//   크게   : 오늘 일정(7개), 내일 일정, D-day, 올해 목표 진행도, 오늘의 인생 목표
//   잠금 화면: 다음 일정 / 한 줄 / 올해 진행률(동그라미)
//
// 이 파일 맨 위 세 줄은 캘린더가 채워 준다 (DATA_URL 안의 토큰이 열쇠라서 남에게 보내지 마세요).
// 위젯 링크를 '끊으면' 이 위젯은 더 이상 새로 그려지지 않는다.

const DATA_URL = "__DATA_URL__";
const APP_URL = "__APP_URL__";
const ACCENT = "__ACCENT__";

const CACHE = "onlyforme-widget.json";
const REFRESH_MINUTES = 15;

// ---------------------------------------------------------------- 색
const accent = new Color(ACCENT);
const ink = Color.dynamic(new Color("#141821"), new Color("#ECEFF4"));
const muted = Color.dynamic(new Color("#5E6675"), new Color("#A3ABB9"));
const faint = Color.dynamic(new Color("#8C94A3"), new Color("#7C8594"));
const paper = Color.dynamic(new Color("#FFFFFF"), new Color("#1A1E25"));
const track = Color.dynamic(new Color("#E4E8EF"), new Color("#2C323D"));
const sun = Color.dynamic(new Color("#D64545"), new Color("#FF7B72"));

// ---------------------------------------------------------------- 데이터 (못 받으면 마지막으로 받은 것)
async function loadData() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), CACHE);
  try {
    const req = new Request(DATA_URL);
    req.timeoutInterval = 12;
    const data = await req.loadJSON();
    if (req.response && req.response.statusCode === 404) return { gone: true };
    if (!data || data.error) throw new Error(data && data.error);
    fm.writeString(path, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(path)) {
      const data = JSON.parse(fm.readString(path));
      data.offline = true;
      return data;
    }
    return { error: true };
  }
}

// ---------------------------------------------------------------- 그리기 도구
function text(stack, value, size, { weight = "regular", color = ink, lines = 1, scale = 0.75 } = {}) {
  const t = stack.addText(String(value));
  t.font = weight === "bold" ? Font.boldSystemFont(size)
    : weight === "semibold" ? Font.semiboldSystemFont(size)
    : weight === "medium" ? Font.mediumSystemFont(size)
    : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = scale;
  return t;
}

function row(stack) {
  const r = stack.addStack();
  r.layoutHorizontally();
  r.centerAlignContent();
  return r;
}

function column(stack) {
  const c = stack.addStack();
  c.layoutVertically();
  return c;
}

function bar(stack, ratio, width, height = 5) {
  const b = stack.addStack();
  b.size = new Size(width, height);
  b.cornerRadius = height / 2;
  b.backgroundColor = track;
  b.layoutHorizontally();
  const fill = b.addStack();
  fill.size = new Size(Math.max(height, Math.round(width * Math.min(1, Math.max(0, ratio)))), height);
  fill.cornerRadius = height / 2;
  fill.backgroundColor = accent;
  b.addSpacer();
  return b;
}

function dot(stack, hex, h = 13) {
  const d = stack.addStack();
  d.size = new Size(3, h);
  d.cornerRadius = 1.5;
  d.backgroundColor = new Color(hex || "#9AA0AA");
  return d;
}

const timeOf = (o) => (o.start ? o.start : o.end ? `~${o.end}` : "하루");
const ddayLabel = (n) => (n === 0 ? "D-day" : `D-${n}`);
const dateTitle = (data) => {
  const [, m, d] = data.date.split("-").map(Number);
  return `${m}월 ${d}일 ${data.weekday}요일`;
};
const progressText = (g) => (g.measure === "check" ? "" : `${g.current}/${g.target}`);
// 다음 수업 (시간표, 0.13.0): '🎓 10:30 컴퓨터구조 · 공학관 301' (오늘이 아니면 '내일', '11/20(목)')
const whenOf = (c) => (c.day === "today" ? "" : c.day === "tomorrow" ? "내일 " : `${c.day} `);
const classText = (c) => `🎓 ${whenOf(c)}${c.start} ${c.title}${c.place ? ` · ${c.place}` : ""}`;

function itemRow(stack, o, size = 13) {
  const r = row(stack);
  dot(r, o.color, size);
  r.addSpacer(6);
  text(r, timeOf(o), size - 1, { weight: "semibold", color: muted }).font = Font.semiboldMonospacedSystemFont
    ? Font.semiboldMonospacedSystemFont(size - 1) : Font.semiboldSystemFont(size - 1);
  r.addSpacer(6);
  text(r, o.title, size, { weight: "medium" });
  r.addSpacer();
  return r;
}

function goalRow(stack, g, width) {
  const c = column(stack);
  const top = row(c);
  text(top, `${g.emoji ? `${g.emoji} ` : ""}${g.title}`, 11.5, { weight: "medium" });
  top.addSpacer();
  if (g.measure !== "check") text(top, progressText(g), 11, { weight: "bold", color: accent });
  if (g.measure !== "check") {
    c.addSpacer(3);
    bar(c, g.current / (g.target || 1), width, 4);
  }
  return c;
}

function footer(stack, data) {
  const f = row(stack);
  if (data.offline) text(f, `⚠︎ 연결 안 됨 · ${data.updated} 기준`, 9.5, { color: sun });
  else text(f, `${data.updated} 업데이트`, 9.5, { color: faint });
  f.addSpacer();
}

// ---------------------------------------------------------------- 크기별 화면
function small(w, data) {
  text(w, dateTitle(data), 12, { weight: "bold", color: accent });
  w.addSpacer(6);
  if (data.next) {
    text(w, data.next.day === "tomorrow" ? `내일 ${timeOf(data.next)}` : timeOf(data.next), 12, { weight: "semibold", color: muted });
    text(w, data.next.title, 16, { weight: "bold", lines: 2 });
  } else {
    text(w, data.today.length ? "남은 시간 일정 없음" : "오늘 일정 없음", 15, { weight: "bold", lines: 2 });
  }
  text(w, `오늘 일정 ${data.today.length}개${data.todos ? ` · 할 일 ${data.todos}` : ""}`, 11, { color: muted });
  if (data.class) text(w, classText(data.class), 11, { weight: "medium", color: muted });
  w.addSpacer();
  if (data.ddays.length) {
    const d = data.ddays[0];
    const r = row(w);
    text(r, ddayLabel(d.days_left), 11, { weight: "bold", color: d.days_left <= 3 ? sun : accent });
    r.addSpacer(5);
    text(r, d.title, 11, { weight: "medium" });
    w.addSpacer(5);
  }
  const y = row(w);
  text(y, String(data.year.year), 10, { weight: "bold", color: muted });
  y.addSpacer(5);
  bar(y, data.year.percent / 100, 70, 5);
  y.addSpacer(5);
  text(y, `${data.year.percent}%`, 10, { weight: "semibold", color: muted });
}

function medium(w, data) {
  const body = row(w);
  body.topAlignContent();
  const left = column(body);
  text(left, dateTitle(data), 13, { weight: "bold", color: accent });
  if (data.class) text(left, classText(data.class), 11, { weight: "medium", color: muted });
  left.addSpacer(7);
  if (!data.today.length) text(left, "오늘 일정 없음", 13, { color: muted });
  for (const o of data.today.slice(0, 4)) {
    itemRow(left, o, 12.5);
    left.addSpacer(5);
  }
  if (data.today.length > 4) text(left, `+${data.today.length - 4}개 더`, 10.5, { color: faint });
  left.addSpacer();
  footer(left, data);

  body.addSpacer(12);
  const right = column(body);
  right.size = new Size(118, 0);
  for (const d of data.ddays.slice(0, 2)) {
    const r = row(right);
    text(r, ddayLabel(d.days_left), 11, { weight: "bold", color: d.days_left <= 3 ? sun : accent });
    r.addSpacer(4);
    text(r, d.title, 11, { weight: "medium" });
    r.addSpacer();
    right.addSpacer(4);
  }
  right.addSpacer();
  const goals = data.year.goals.slice(0, 2);
  if (goals.length) {
    for (const g of goals) {
      goalRow(right, g, 118);
      right.addSpacer(6);
    }
  } else {
    text(right, `${data.year.year}년 ${data.year.percent}%`, 11, { weight: "semibold", color: muted });
    right.addSpacer(3);
    bar(right, data.year.percent / 100, 118, 4);
  }
}

function large(w, data) {
  const head = row(w);
  text(head, dateTitle(data), 15, { weight: "bold", color: accent });
  head.addSpacer();
  text(head, `${data.year.year} · ${data.year.percent}%`, 11, { weight: "semibold", color: muted });
  if (data.life) {
    w.addSpacer(2);
    text(w, `🧭 ${data.life}`, 11.5, { color: muted });
  }
  if (data.class) {
    w.addSpacer(2);
    text(w, `다음 수업 ${classText(data.class)}`, 11.5, { weight: "medium" });
  }
  w.addSpacer(10);
  text(w, "오늘", 11, { weight: "bold", color: muted });
  w.addSpacer(4);
  if (!data.today.length) text(w, "일정 없음", 13, { color: faint });
  for (const o of data.today.slice(0, 7)) {
    itemRow(w, o, 13);
    w.addSpacer(5);
  }
  if (data.tomorrow.length) {
    w.addSpacer(6);
    text(w, "내일", 11, { weight: "bold", color: muted });
    w.addSpacer(4);
    for (const o of data.tomorrow.slice(0, 3)) {
      itemRow(w, o, 12);
      w.addSpacer(4);
    }
  }
  w.addSpacer();
  const bottom = row(w);
  bottom.topAlignContent();
  const dd = column(bottom);
  for (const d of data.ddays.slice(0, 3)) {
    const r = row(dd);
    text(r, ddayLabel(d.days_left), 11, { weight: "bold", color: d.days_left <= 3 ? sun : accent });
    r.addSpacer(4);
    text(r, d.title, 11, { weight: "medium" });
    dd.addSpacer(3);
  }
  bottom.addSpacer(12);
  const gs = column(bottom);
  gs.size = new Size(140, 0);
  for (const g of data.year.goals.slice(0, 3)) {
    goalRow(gs, g, 140);
    gs.addSpacer(5);
  }
  w.addSpacer(6);
  footer(w, data);
}

// 잠금 화면
function rectangular(w, data) {
  if (data.next) {
    text(w, `${data.next.day === "tomorrow" ? "내일 " : ""}${timeOf(data.next)} ${data.next.title}`, 14, { weight: "bold" });
  } else {
    text(w, data.today.length ? `오늘 일정 ${data.today.length}개` : "오늘 일정 없음", 14, { weight: "bold" });
  }
  const d = data.ddays[0];
  if (d) text(w, `${ddayLabel(d.days_left)} ${d.title}`, 12);
  const g = data.year.goals.find((x) => x.measure !== "check");
  if (data.class) text(w, classText(data.class), 12);
  else if (g) text(w, `${g.emoji ? `${g.emoji} ` : ""}${g.title} ${progressText(g)}`, 12);
  else text(w, `${data.year.year}년 ${data.year.percent}%`, 12);
}

function inline(w, data) {
  if (data.next) text(w, `📅 ${data.next.day === "tomorrow" ? "내일 " : ""}${timeOf(data.next)} ${data.next.title}`, 12);
  else text(w, `📅 오늘 일정 ${data.today.length}개`, 12);
}

function circular(w, data) {
  w.addAccessoryWidgetBackground = true;
  const c = column(w);
  c.centerAlignContent();
  text(c, `${data.year.percent}%`, 15, { weight: "bold" }).centerAlignText();
  text(c, String(data.year.year), 9, { color: muted }).centerAlignText();
}

function problem(w, message) {
  text(w, "오직 나를 위한 캘린더", 12, { weight: "bold", color: accent });
  w.addSpacer(6);
  text(w, message, 12, { color: muted, lines: 4 });
}

// ---------------------------------------------------------------- 시작
const family = config.widgetFamily || "medium";
const data = await loadData();
const w = new ListWidget();
w.url = APP_URL;
w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
const lockScreen = family.startsWith("accessory");
if (!lockScreen) {
  w.backgroundColor = paper;
  w.setPadding(14, 14, 12, 14);
}

if (data.gone) problem(w, "위젯 링크가 끊겼어요. 캘린더에서 새 위젯을 만들어 스크립트를 다시 붙여 넣어 주세요.");
else if (data.error) problem(w, "캘린더에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
else if (family === "small") small(w, data);
else if (family === "large" || family === "extraLarge") large(w, data);
else if (family === "accessoryRectangular") rectangular(w, data);
else if (family === "accessoryInline") inline(w, data);
else if (family === "accessoryCircular") circular(w, data);
else medium(w, data);

if (config.runsInWidget) {
  Script.setWidget(w);
} else {
  // 앱에서 ▶︎를 누르면 미리 보기
  if (family === "small") await w.presentSmall();
  else if (family === "large") await w.presentLarge();
  else await w.presentMedium();
}
Script.complete();
