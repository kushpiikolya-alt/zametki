(function () {
  "use strict";
  const SB_URL = "https://lzpeqvveioktdiqtsbyi.supabase.co";
  const SB_KEY = "sb_publishable_FWTcpcB1M6YQO3WS13kwXg_EU0ZESRs";
  const $ = id => document.getElementById(id);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  let uid = null, email = "", notes = new Map();   // id -> {id,title,body,pinned,updated,deleted,dirty}
  let currentId = null, query = "", view = "all", confirmDel = false, pushTimer = null, pushing = false, channel = null;
  const DAY = 864e5;

  // ---------- helpers ----------
  const plural = n => { const a = n % 10, b = n % 100; return n + " " + (a === 1 && b !== 11 ? "заметка" : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? "заметки" : "заметок"); };
  const fmt = ts => {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return "сегодня, " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const y = new Date(now - DAY); if (d.toDateString() === y.toDateString()) return "вчера, " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  };
  // ---------- форматированный текст ----------
  const isHtml = b => /^\s*</.test(b || "") && /<\/?(div|p|br|b|strong|i|em|u|s|strike|mark|ul|ol|li|h[1-3]|span|blockquote)\b/i.test(b);
  const esc = t => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TAGS = new Set(["B","STRONG","I","EM","U","S","STRIKE","MARK","BR","DIV","P","UL","OL","LI","H1","H2","H3","BLOCKQUOTE","SPAN","FONT","TABLE","THEAD","TBODY","TR","TH","TD"]);
  const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|[a-z]+)$/i;
  function sanitize(html) {
    const t = document.createElement("template"); t.innerHTML = html;
    (function walk(node) {
      for (const el of [...node.children]) {
        if (!TAGS.has(el.tagName)) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|svg|math)$/i.test(el.tagName)) el.remove(); else { walk(el); el.replaceWith(...el.childNodes); } continue; }
        const keep = {};
        if (/^(SPAN|FONT|MARK|B|STRONG|I|EM|U|S|STRIKE)$/.test(el.tagName)) {
          const bg = el.style.backgroundColor, fg = el.style.color || el.getAttribute("color");
          if (bg && COLOR.test(bg.trim())) keep.style = "background-color:" + bg;
          if (fg && COLOR.test(fg.trim())) keep.style = (keep.style ? keep.style + ";" : "") + "color:" + fg;
          if (el.style.fontWeight === "bold" || +el.style.fontWeight >= 600) keep.style = (keep.style ? keep.style + ";" : "") + "font-weight:700";
          if (el.style.fontStyle === "italic") keep.style = (keep.style ? keep.style + ";" : "") + "font-style:italic";
          const td = el.style.textDecorationLine || el.style.textDecoration || "";
          if (/underline|line-through/.test(td)) keep.style = (keep.style ? keep.style + ";" : "") + "text-decoration:" + td.match(/underline|line-through/g).join(" ");
        }
        if (el.tagName === "UL" && el.classList.contains("checklist")) keep.class = "checklist";
        if (el.tagName === "LI" && el.dataset.done === "1") keep["data-done"] = "1";
        for (const a of [...el.attributes]) el.removeAttribute(a.name);
        for (const k in keep) el.setAttribute(k, keep[k]);
        walk(el);
      }
    })(t.content);
    return t.innerHTML;
  }
  const toHtml = b => isHtml(b) ? sanitize(b) : (b || "").split("\n").map(l => "<div>" + (l ? esc(l) : "<br>") + "</div>").join("");
  function plain(b) {
    if (!isHtml(b)) return b || "";
    const t = document.createElement("template");
    t.innerHTML = b.replace(/<\/t[dh]>/gi, "  ").replace(/<\/tr>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|h[1-3]|blockquote)>/gi, "\n");
    return t.content.textContent.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n");
  }
  const lines = s => plain(s).split("\n").filter(l => l.trim());
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
  function setSync(state, text) { $("dot").className = "dot " + (state || ""); $("syncText").textContent = text; }
  const cacheKey = () => "zm.notes." + uid;
  function saveCache() {
    const arr = [...notes.values()];
    ls.set(cacheKey(), arr);
    ls.set("notes.v1", arr.filter(n => !n.deleted).map(n => ({ title: n.title, body: plain(n.body) })));   // T9 learns words from this
  }
  const fromRow = r => ({ id: r.id, title: r.title || "", body: r.body || "", pinned: !!r.pinned, updated: Date.parse(r.updated_at) || Date.now(), deleted: r.deleted_at ? Date.parse(r.deleted_at) : null, dirty: false });
  const toRow = n => ({ id: n.id, user_id: uid, title: n.title, body: n.body, pinned: n.pinned, updated_at: new Date(n.updated).toISOString(), deleted_at: n.deleted ? new Date(n.deleted).toISOString() : null });

  // ---------- theme ----------
  const THEMES = ["auto", "light", "dark"], THEME_RU = { auto: "авто", light: "светлая", dark: "тёмная" };
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    $("themeBtn").textContent = "Тема: " + THEME_RU[t];
    const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]').content = dark ? "#171c25" : "#e3e8ef";
  }
  let theme = ls.get("zm.theme", "auto"); applyTheme(theme);
  $("themeBtn").onclick = () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; ls.set("zm.theme", theme); applyTheme(theme); };

  // ---------- auth ----------
  const AUTH_ERR = m => {
    m = (m || "").toLowerCase();
    if (m.includes("invalid login")) return "Пароль не подходит. Нажмите «Показать» и проверьте раскладку (EN/RU) и большие буквы.";
    if (m.includes("already registered") || m.includes("already exists")) return "Такой аккаунт уже есть. Нажмите «Войти».";
    if (m.includes("password") && m.includes("6")) return "Пароль должен быть не короче 6 символов.";
    if (m.includes("email") && (m.includes("invalid") || m.includes("valid"))) return "Проверьте адрес почты.";
    if (m.includes("not confirmed")) return "Почта не подтверждена. Откройте письмо и нажмите ссылку.";
    if (m.includes("fetch") || m.includes("network")) return "Нет соединения с интернетом.";
    return "Не получилось: " + m;
  };
  async function doAuth(kind) {
    const e = $("email").value.trim().toLowerCase(), p = $("password").value;
    const msg = $("authMsg"); msg.className = "auth-msg";
    if (!e || !p) { msg.textContent = "Введите почту и пароль."; return; }
    if (p.length < 6) { msg.textContent = "Пароль должен быть не короче 6 символов."; return; }
    $("signIn").disabled = $("signUp").disabled = true; msg.textContent = kind === "up" ? "Создаю аккаунт…" : "Вхожу…";
    try {
      const r = kind === "up" ? await sb.auth.signUp({ email: e, password: p }) : await sb.auth.signInWithPassword({ email: e, password: p });
      if (r.error) throw r.error;
      if (kind === "up" && !r.data.session) { msg.className = "auth-msg ok"; msg.textContent = "Аккаунт создан. Подтвердите почту по ссылке в письме и нажмите «Войти»."; }
    } catch (err) { msg.textContent = AUTH_ERR(err.message); }
    $("signIn").disabled = $("signUp").disabled = false;
  }
  $("pwEye").onclick = () => { const i = $("password"), show = i.type === "password"; i.type = show ? "text" : "password"; $("pwEye").textContent = show ? "Скрыть" : "Показать"; };
  $("authForm").onsubmit = ev => { ev.preventDefault(); doAuth("in"); };
  $("signUp").onclick = () => doAuth("up");
  $("logoutBtn").onclick = async () => {
    if (!$("logoutBtn").dataset.sure) { $("logoutBtn").dataset.sure = "1"; $("logoutBtn").textContent = "Точно выйти?"; setTimeout(() => { delete $("logoutBtn").dataset.sure; $("logoutBtn").textContent = "Выйти"; }, 3000); return; }
    await pushNow();
    if (channel) sb.removeChannel(channel);
    await sb.auth.signOut();
  };

  function showAuth() { $("app").hidden = true; $("auth").hidden = false; uid = null; notes = new Map(); }
  function showApp(session) {
    const newUser = session.user.id !== uid;
    uid = session.user.id; email = session.user.email || "";
    $("auth").hidden = true; $("app").hidden = false; $("who").textContent = email;
    if (!newUser) return;
    notes = new Map((ls.get(cacheKey(), [])).map(n => [n.id, n]));
    const legacy = ls.get("zm.pendingImport", null);
    purgeTrash(); renderList(); renderEditor();
    if (legacy) { ls.set("zm.pendingImport", null); importArray(legacy); }
    pull(); subscribe();
    if (/[?&]new=1/.test(location.search)) { history.replaceState(null, "", location.pathname); create(); }
  }
  sb.auth.onAuthStateChange((ev, session) => { if (session) showApp(session); else showAuth(); });
  sb.auth.getSession().then(({ data }) => { if (data.session) showApp(data.session); else showAuth(); });

  // ---------- sync ----------
  async function pull() {
    if (!navigator.onLine) { setSync("warn", "Нет сети, работаю офлайн"); return; }
    setSync("", "Синхронизирую…");
    const { data, error } = await sb.from("notes").select("*");
    if (error) { setSync("warn", "Не удалось загрузить, показываю сохранённое"); return; }
    const seen = new Set();
    for (const r of data) {
      seen.add(r.id);
      const remote = fromRow(r), local = notes.get(r.id);
      if (!local || !local.dirty || remote.updated >= local.updated) notes.set(r.id, remote);
    }
    for (const [id, n] of notes) if (!seen.has(id) && !n.dirty) notes.delete(id);   // deleted on another device
    saveCache(); renderList(); if (!editingNow()) renderEditor();
    await pushNow();
    setSync("ok", "Синхронизировано");
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("notes-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: "user_id=eq." + uid }, p => {
        if (p.eventType === "DELETE") { const id = p.old && p.old.id; if (id && notes.has(id) && !notes.get(id).dirty) notes.delete(id); }
        else { const remote = fromRow(p.new), local = notes.get(remote.id);
          if (local && local.dirty && local.updated > remote.updated) return;
          if (local && !local.dirty && local.updated === remote.updated && local.body === remote.body && local.title === remote.title && local.pinned === remote.pinned && local.deleted === remote.deleted) return;
          notes.set(remote.id, remote);
          if (remote.id === currentId && editingNow()) { renderList(); return; } }
        saveCache(); renderList(); if (!editingNow()) renderEditor();
      })
      .subscribe(s => { if (s === "SUBSCRIBED") setSync("ok", "Синхронизировано"); });
  }
  function schedulePush(delay) { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, delay == null ? 700 : delay); }
  async function pushNow() {
    clearTimeout(pushTimer);
    const dirty = [...notes.values()].filter(n => n.dirty);
    if (!dirty.length || !uid) return;
    if (!navigator.onLine) { setSync("warn", "Нет сети, сохранено на устройстве"); return; }
    if (pushing) { schedulePush(400); return; }
    pushing = true; setSync("", "Сохраняю…");
    const snap = new Map(dirty.map(n => [n.id, n.updated]));
    const { error } = await sb.from("notes").upsert(dirty.map(toRow));
    pushing = false;
    if (error) { setSync("warn", "Не сохранилось в облако, повторю"); schedulePush(5000); return; }
    for (const [id, upd] of snap) { const n = notes.get(id); if (n && n.updated === upd) n.dirty = false; }
    saveCache(); setSync("ok", "Сохранено");
    if ([...notes.values()].some(n => n.dirty)) schedulePush(300);
  }
  window.addEventListener("online", () => pull());
  window.addEventListener("offline", () => setSync("warn", "Нет сети, сохранено на устройстве"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pushNow(); else if (uid) pull(); });
  window.addEventListener("pagehide", () => pushNow());

  function change(id, patch) {
    const n = notes.get(id); if (!n) return;
    Object.assign(n, patch, { updated: Date.now(), dirty: true });
    saveCache(); renderList(); $("meta").textContent = "Сохраняю…"; setSync("", "Сохраняю…");
    schedulePush();
  }
  async function purgeTrash() {
    const old = [...notes.values()].filter(n => n.deleted && Date.now() - n.deleted > 30 * DAY);
    for (const n of old) { notes.delete(n.id); sb.from("notes").delete().eq("id", n.id).then(() => {}); }
    if (old.length) saveCache();
  }

  // ---------- UI ----------
  const editingNow = () => { const a = document.activeElement; return a && (a.id === "noteTitle" || a.id === "noteBody"); };
  function visible() {
    const q = query.trim().toLowerCase();
    return [...notes.values()].filter(n => (view === "trash" ? n.deleted : !n.deleted) && (!q || (n.title + " " + plain(n.body)).toLowerCase().includes(q)))
      .sort((a, b) => view === "trash" ? b.deleted - a.deleted : (b.pinned - a.pinned) || (b.updated - a.updated));
  }
  function renderList() {
    const list = $("list"); list.innerHTML = "";
    const active = [...notes.values()].filter(n => !n.deleted), trashed = notes.size - active.length;
    $("railTitle").textContent = view === "trash" ? "Корзина" : "Заметки";
    $("count").textContent = view === "trash" ? "удаляются через 30 дней" : plural(active.length);
    $("trashLink").textContent = view === "trash" ? "‹ Все заметки" : "Корзина" + (trashed ? " · " + trashed : "");
    $("newBtn").hidden = view === "trash"; $("fab").hidden = view === "trash";
    const items = visible();
    if (!items.length) {
      const e = document.createElement("div"); e.className = "empty-list";
      e.textContent = view === "trash" ? "Корзина пуста." : query ? "Ничего не найдено." : "Здесь появятся ваши заметки. Нажмите «+», чтобы написать первую.";
      list.append(e); return;
    }
    const hasPinned = view !== "trash" && items.some(n => n.pinned);
    let lastGroup = null;
    for (const n of items) {
      if (hasPinned) { const g = n.pinned ? "Закреплённые" : "Все"; if (g !== lastGroup) { const h = document.createElement("div"); h.className = "group"; h.textContent = g; list.append(h); lastGroup = g; } }
      const b = document.createElement("button"); b.className = "item"; b.setAttribute("aria-current", String(n.id === currentId && view !== "trash"));
      const t = document.createElement("div"); t.className = "t";
      if (n.pinned && view !== "trash") { const p = document.createElement("span"); p.className = "pin"; p.textContent = "●"; t.append(p); }
      const L = lines(n.body);
      t.append(document.createTextNode(n.title || L[0] || "Без названия"));
      const p = document.createElement("div"); p.className = "p"; p.textContent = (n.title ? L[0] : L[1]) || "Пусто";
      const d = document.createElement("div"); d.className = "d"; d.textContent = view === "trash" ? "удалено " + fmt(n.deleted) : fmt(n.updated);
      b.append(t, p, d);
      if (view === "trash") {
        const acts = document.createElement("div"); acts.className = "item-actions";
        const r = document.createElement("span"); r.textContent = "Восстановить";
        const x = document.createElement("span"); x.className = "del"; x.textContent = "Удалить навсегда";
        r.onclick = ev => { ev.stopPropagation(); change(n.id, { deleted: null }); toast("Заметка восстановлена"); };
        x.onclick = async ev => { ev.stopPropagation();
          if (x.dataset.sure !== "1") { x.dataset.sure = "1"; x.textContent = "Точно? Нажмите ещё раз"; return; }
          notes.delete(n.id); saveCache(); renderList(); await sb.from("notes").delete().eq("id", n.id); toast("Удалено навсегда"); };
        acts.append(r, x); b.append(acts);
      } else b.onclick = () => open(n.id);
      list.append(b);
    }
  }
  function renderEditor() {
    const inner = $("inner"); inner.innerHTML = ""; confirmDel = false;
    const n = currentId && notes.get(currentId);
    $("pinBtn").hidden = $("delBtn").hidden = !n || !!(n && n.deleted);
    $("delBtn").textContent = "Удалить"; $("delBtn").classList.remove("danger");
    if (!n || n.deleted) {
      $("meta").textContent = "";
      inner.innerHTML = '<div class="blank"><b>Выберите заметку или создайте новую</b><span>Всё сохраняется само и появляется на других ваших устройствах.</span>' +
        '<div class="keys"><span><kbd>Alt+N</kbd> новая</span><span><kbd>Ctrl+K</kbd> поиск</span><span><kbd>Esc</kbd> к списку</span></div></div>';
      return;
    }
    $("pinBtn").textContent = n.pinned ? "Открепить" : "Закрепить"; $("pinBtn").classList.toggle("on", n.pinned);
    $("meta").textContent = "Изменено " + fmt(n.updated);
    const ti = document.createElement("input"); ti.className = "title"; ti.id = "noteTitle"; ti.placeholder = "Заголовок"; ti.value = n.title; ti.enterKeyHint = "next";
    const tb = buildToolbar();
    const ta = document.createElement("div"); ta.className = "body rich"; ta.id = "noteBody"; ta.contentEditable = "true";
    ta.setAttribute("role", "textbox"); ta.setAttribute("aria-multiline", "true"); ta.dataset.placeholder = "Начните писать…";
    ta.innerHTML = toHtml(n.body);
    const markEmpty = () => ta.classList.toggle("is-empty", !ta.textContent.trim() && !ta.querySelector("li"));
    markEmpty();
    let bodyTimer;
    const saveBody = () => { clearTimeout(bodyTimer); markEmpty(); bodyTimer = setTimeout(() => change(n.id, { body: ta.innerHTML }), 250); };
    ti.addEventListener("input", () => change(n.id, { title: ti.value }));
    ti.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ta.focus(); } });
    ta.addEventListener("input", e => {
      if (e.inputType === "insertParagraph") {           // новая строка чек-листа — без галочки
        const li = selLi(); if (li && li.dataset.done && !li.textContent.trim()) delete li.dataset.done;
      }
      saveBody();
    });
    ta.addEventListener("paste", e => {
      const html = e.clipboardData.getData("text/html"), txt = e.clipboardData.getData("text/plain");
      e.preventDefault();
      if (html) document.execCommand("insertHTML", false, sanitize(html));
      else document.execCommand("insertText", false, txt);
    });
    ta.addEventListener("click", e => {
      const li = e.target.closest && e.target.closest("ul.checklist > li");
      if (li && ta.contains(li) && e.clientX - li.getBoundingClientRect().left < 28) {
        if (li.dataset.done) delete li.dataset.done; else li.dataset.done = "1";
        saveBody();
      }
    });
    ta.addEventListener("keydown", e => {
      const k = e.code, mod = e.ctrlKey || e.metaKey;
      if (e.key === "Tab" && !e.altKey && !mod) {
        const cell = selCell();
        if (cell) {
          e.preventDefault(); e.stopImmediatePropagation();
          const all = [...cell.closest("table").querySelectorAll("th,td")], i = all.indexOf(cell);
          if (e.shiftKey) { if (i > 0) caretIn(all[i - 1], true); }
          else if (i < all.length - 1) caretIn(all[i + 1], true);
          else { tableOp("rowAdd"); const c2 = selCell(); if (c2) caretIn(c2.parentNode.firstElementChild); }
          return;
        }
      }
      if (mod && e.shiftKey && k === "KeyH") { e.preventDefault(); applyFmt("mark"); }
      else if (mod && e.shiftKey && k === "KeyX") { e.preventDefault(); applyFmt("strikeThrough"); }
      else if (mod && e.shiftKey && k === "Digit7") { e.preventDefault(); applyFmt("ol"); }
      else if (mod && e.shiftKey && k === "Digit8") { e.preventDefault(); applyFmt("ul"); }
      else if (mod && e.shiftKey && k === "Digit9") { e.preventDefault(); applyFmt("check"); }
      else if (mod && e.altKey && k === "Digit2") { e.preventDefault(); applyFmt("h"); }
    });
    inner.append(tb, ti, ta);
    if (window.T9) { T9.attach(ti); T9.attach(ta); }
  }
  function selLi() {
    const sel = getSelection(); if (!sel.rangeCount) return null;
    let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    return n && n.closest ? n.closest("li") : null;
  }
  function selBlock() {
    const sel = getSelection(); if (!sel.rangeCount) return null;
    let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    return n && n.closest ? n.closest("h1,h2,h3,div,p,li") : null;
  }
  function inEditor() { const sel = getSelection(), ed = $("noteBody"); return ed && sel.rangeCount && ed.contains(sel.anchorNode); }
  function applyFmt(cmd) {
    const ed = $("noteBody"); if (!ed) return;
    if (!inEditor()) { ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); }
    document.execCommand("styleWithCSS", false, false);
    if (cmd === "mark") {
      const sel = getSelection(); let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
      const marked = n && n.closest && n.closest('span[style*="background"], mark, font[style*="background"]');
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("hiliteColor", false, marked && ed.contains(marked) ? "transparent" : "#ffe36b");
      document.execCommand("styleWithCSS", false, false);
    } else if (cmd === "color") {
      document.execCommand("styleWithCSS", false, true);
      const sel = getSelection(); let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
      const red = n && n.closest && n.closest('span[style*="color"]') && /rgb\(220, 53, 34\)/.test(n.closest('span[style*="color"]').style.color);
      document.execCommand("foreColor", false, red ? "inherit" : "#dc3522");
      document.execCommand("styleWithCSS", false, false);
    } else if (cmd === "h") {
      const b = selBlock(); document.execCommand("formatBlock", false, b && /^H2$/.test(b.tagName) ? "div" : "h2");
    } else if (cmd === "table") { if (!selCell()) insertTable(); }
    else if (cmd === "ul") document.execCommand("insertUnorderedList");
    else if (cmd === "ol") document.execCommand("insertOrderedList");
    else if (cmd === "check") {
      const li = selLi(), ul = li && li.parentNode;
      if (ul && ul.classList && ul.classList.contains("checklist")) { document.execCommand("insertUnorderedList"); }
      else {
        if (!(ul && ul.tagName === "UL")) document.execCommand("insertUnorderedList");
        const li2 = selLi(); if (li2 && li2.parentNode.tagName === "UL") li2.parentNode.classList.add("checklist");
        else if (li2) { document.execCommand("insertUnorderedList"); const li3 = selLi(); li3 && li3.parentNode.classList.add("checklist"); }
      }
    } else if (cmd === "clear") { document.execCommand("removeFormat"); document.execCommand("styleWithCSS", false, true); document.execCommand("hiliteColor", false, "transparent"); document.execCommand("styleWithCSS", false, false);
      const b = selBlock(); if (b && /^H[1-3]$/.test(b.tagName)) document.execCommand("formatBlock", false, "div"); }
    else document.execCommand(cmd);
    ed.dispatchEvent(new Event("input", { bubbles: true }));
    updateToolbar();
  }
  const TOOLS = [
    ["bold", "<b>Ж</b>", "Жирный (Ctrl+B)"], ["italic", "<i>К</i>", "Курсив (Ctrl+I)"], ["underline", "<u>Ч</u>", "Подчеркнуть (Ctrl+U)"],
    ["strikeThrough", "<s>З</s>", "Зачеркнуть (Ctrl+Shift+X)"], ["mark", '<span class="mk">Маркер</span>', "Выделить маркером (Ctrl+Shift+H)"],
    ["color", '<span class="red">А</span>', "Красный текст"], ["|"], ["h", "Заголовок", "Заголовок (Ctrl+Alt+2)"],
    ["ul", "• Список", "Маркированный список (Ctrl+Shift+8)"], ["ol", "1. Список", "Нумерованный список (Ctrl+Shift+7)"],
    ["check", "☑ Дела", "Чек-лист (Ctrl+Shift+9)"], ["table", "▦ Таблица", "Вставить таблицу"], ["|"], ["clear", "Очистить", "Убрать форматирование"]
  ];
  const TABLE_TOOLS = [["rowAdd", "+ строка", "Добавить строку ниже"], ["colAdd", "+ столбец", "Добавить столбец справа"],
    ["rowDel", "− строка", "Удалить строку"], ["colDel", "− столбец", "Удалить столбец"], ["tdel", "Удалить таблицу", "Удалить всю таблицу"]];
  function selCell() {
    const sel = getSelection(), ed = $("noteBody"); if (!sel.rangeCount || !ed) return null;
    let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    const c = n && n.closest ? n.closest("td,th") : null;
    return c && ed.contains(c) ? c : null;
  }
  function caretIn(cell, atEnd) {
    const r = document.createRange(); r.selectNodeContents(cell); r.collapse(!atEnd);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  const newCell = tag => { const c = document.createElement(tag); c.innerHTML = "<br>"; return c; };
  function insertTable() {
    let h = '<table><tbody><tr><th><br></th><th><br></th><th><br></th></tr>';
    for (let i = 0; i < 2; i++) h += "<tr><td><br></td><td><br></td><td><br></td></tr>";
    h += "</tbody></table><div><br></div>";
    const marker = "tbl-" + Date.now();
    document.execCommand("insertHTML", false, h.replace("<table>", '<table data-new="' + marker + '">'));
    const t = document.querySelector('table[data-new="' + marker + '"]');
    if (t) { t.removeAttribute("data-new"); caretIn(t.querySelector("th"), false); }
  }
  function tableOp(cmd) {
    const cell = selCell(); if (!cell) return;
    const row = cell.parentNode, table = cell.closest("table"), idx = [...row.children].indexOf(cell);
    const rows = [...table.querySelectorAll("tr")];
    if (cmd === "rowAdd") {
      const r = document.createElement("tr");
      for (let i = 0; i < row.children.length; i++) r.append(newCell("td"));
      row.after(r); caretIn(r.children[Math.min(idx, r.children.length - 1)]);
    } else if (cmd === "colAdd") {
      for (const r of rows) { const ref = r.children[idx]; const c = newCell(ref && ref.tagName === "TH" ? "th" : "td"); ref ? ref.after(c) : r.append(c); }
      caretIn(row.children[idx + 1]);
    } else if (cmd === "rowDel") {
      if (rows.length <= 1) return tableOp("tdel");
      const next = row.nextElementSibling || row.previousElementSibling; row.remove();
      caretIn(next.children[Math.min(idx, next.children.length - 1)]);
    } else if (cmd === "colDel") {
      if (row.children.length <= 1) return tableOp("tdel");
      for (const r of rows) r.children[idx] && r.children[idx].remove();
      caretIn(row.children[Math.max(0, idx - 1)]);
    } else if (cmd === "tdel") {
      const after = table.nextElementSibling; table.remove();
      if (after) caretIn(after); else $("noteBody").focus();
    }
    $("noteBody").dispatchEvent(new Event("input", { bubbles: true }));
    updateToolbar();
  }
  function buildToolbar() {
    const tb = document.createElement("div"); tb.className = "fmtbar"; tb.setAttribute("role", "toolbar"); tb.setAttribute("aria-label", "Форматирование");
    for (const [cmd, label, title] of TOOLS) {
      if (cmd === "|") { const s = document.createElement("span"); s.className = "sep"; tb.append(s); continue; }
      const b = document.createElement("button"); b.type = "button"; b.className = "fbtn"; b.dataset.cmd = cmd; b.innerHTML = label; b.title = title; b.setAttribute("aria-label", title);
      b.addEventListener("mousedown", e => e.preventDefault());       // не терять выделение
      b.addEventListener("click", () => applyFmt(cmd));
      tb.append(b);
    }
    const tt = document.createElement("div"); tt.className = "tbl-tools"; tt.hidden = true;
    for (const [cmd, label, title] of TABLE_TOOLS) {
      const b = document.createElement("button"); b.type = "button"; b.className = "fbtn tb" + (cmd === "tdel" ? " danger" : ""); b.textContent = label; b.title = title;
      b.addEventListener("mousedown", e => e.preventDefault());
      b.addEventListener("click", () => tableOp(cmd));
      tt.append(b);
    }
    tb.append(tt);
    return tb;
  }
  function updateToolbar() {
    const tb = document.querySelector(".fmtbar"); if (!tb || !inEditor()) return;
    const tt = tb.querySelector(".tbl-tools"); if (tt) tt.hidden = !selCell();
    for (const b of tb.querySelectorAll(".fbtn")) {
      const c = b.dataset.cmd; let on = false;
      try {
        if (["bold","italic","underline","strikeThrough"].includes(c)) on = document.queryCommandState(c);
        else if (c === "ul") on = document.queryCommandState("insertUnorderedList") && !(selLi() && selLi().parentNode.classList.contains("checklist"));
        else if (c === "ol") on = document.queryCommandState("insertOrderedList");
        else if (c === "check") on = !!(selLi() && selLi().parentNode.classList.contains("checklist"));
        else if (c === "h") on = !!(selBlock() && selBlock().tagName === "H2");
      } catch (e) {}
      b.classList.toggle("on", on);
    }
  }
  document.addEventListener("selectionchange", updateToolbar);
  try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch (e) {}

  function open(id) {
    currentId = id; $("app").classList.add("editing"); renderList(); renderEditor();
    const n = notes.get(id);
    if (matchMedia("(pointer:fine)").matches || (n && !n.title && !plain(n.body).trim())) setTimeout(() => { const el = n && !n.title && !plain(n.body).trim() ? $("noteTitle") : $("noteBody"); el && el.focus(); }, 30);
  }
  function create() {
    if (view === "trash") { view = "all"; }
    const n = { id: uuid(), title: "", body: "", pinned: false, updated: Date.now(), deleted: null, dirty: true };
    notes.set(n.id, n); query = ""; $("search").value = ""; saveCache(); schedulePush(1500); open(n.id);
  }
  function closeEditor() {
    const n = currentId && notes.get(currentId);
    $("app").classList.remove("editing");
    if (n && !n.title.trim() && !plain(n.body).trim() && !n.deleted) { notes.delete(n.id); saveCache(); sb.from("notes").delete().eq("id", n.id).then(() => {}); currentId = null; renderEditor(); }
    renderList();
  }

  $("newBtn").onclick = create; $("fab").onclick = create;
  $("back").onclick = closeEditor;
  $("search").oninput = e => { query = e.target.value; renderList(); };
  $("trashLink").onclick = () => { view = view === "trash" ? "all" : "trash"; renderList(); };
  $("pinBtn").onclick = () => { const n = notes.get(currentId); if (!n) return; change(n.id, { pinned: !n.pinned }); renderEditor(); };
  $("delBtn").onclick = () => {
    if (!confirmDel) { confirmDel = true; $("delBtn").textContent = "Точно удалить?"; $("delBtn").classList.add("danger"); return; }
    change(currentId, { deleted: Date.now() }); currentId = null;
    $("app").classList.remove("editing"); renderList(); renderEditor(); toast("Перенесено в корзину");
  };
  document.addEventListener("keydown", e => {
    if ($("app").hidden) return;
    if (e.altKey && (e.code === "KeyN")) { e.preventDefault(); create(); }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") { e.preventDefault(); closeEditor(); $("search").focus(); }
    if (e.key === "Escape" && !document.querySelector(".t9chip")) { if (document.activeElement === $("search")) { $("search").value = ""; query = ""; renderList(); } else closeEditor(); }
  });

  // ---------- import / export ----------
  function importArray(arr) {
    if (!Array.isArray(arr)) arr = (arr && arr.notes) || [];
    const sig = n => (n.title || "").trim() + "\u0000" + (n.body || "").trim();
    const have = new Set([...notes.values()].map(sig));
    let added = 0;
    for (const r of arr) {
      if (!r || (!r.title && !r.body)) continue;
      if (have.has(sig(r))) continue;
      const upd = typeof r.updated === "number" ? r.updated : Date.parse(r.updated_at || r.updated) || Date.now();
      const n = { id: uuid(), title: String(r.title || ""), body: String(r.body || ""), pinned: !!r.pinned, updated: upd, deleted: null, dirty: true };
      notes.set(n.id, n); have.add(sig(n)); added++;
    }
    saveCache(); renderList(); pushNow();
    toast(added ? "Добавлено заметок: " + added : "Новых заметок в файле нет");
    return added;
  }
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { importArray(JSON.parse(await f.text())); } catch (err) { toast("Файл не читается — нужен .json из «Экспорта»"); }
    e.target.value = "";
  };
  $("exportBtn").onclick = () => {
    const data = [...notes.values()].filter(n => !n.deleted).map(n => ({ id: n.id, title: n.title, body: n.body, pinned: n.pinned, updated: n.updated }));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = "zametki-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(a); a.click(); a.remove(); toast("Файл сохранён в «Загрузки»");
  };
  window.ZM = { importArray, pushNow };   // used for one-time migration

  if (window.T9) T9.init();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded) return; reloaded = true; pushNow().finally(() => location.reload()); });
  }
})();
