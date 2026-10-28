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
  const lines = s => (s || "").split("\n").filter(l => l.trim());
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
  function setSync(state, text) { $("dot").className = "dot " + (state || ""); $("syncText").textContent = text; }
  const cacheKey = () => "zm.notes." + uid;
  function saveCache() {
    const arr = [...notes.values()];
    ls.set(cacheKey(), arr);
    ls.set("notes.v1", arr.filter(n => !n.deleted).map(n => ({ title: n.title, body: n.body })));   // T9 learns words from this
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
    if (m.includes("invalid login")) return "Неверная почта или пароль.";
    if (m.includes("already registered") || m.includes("already exists")) return "Такой аккаунт уже есть. Нажмите «Войти».";
    if (m.includes("password") && m.includes("6")) return "Пароль должен быть не короче 6 символов.";
    if (m.includes("email") && (m.includes("invalid") || m.includes("valid"))) return "Проверьте адрес почты.";
    if (m.includes("not confirmed")) return "Почта не подтверждена. Откройте письмо и нажмите ссылку.";
    if (m.includes("fetch") || m.includes("network")) return "Нет соединения с интернетом.";
    return "Не получилось: " + m;
  };
  async function doAuth(kind) {
    const e = $("email").value.trim(), p = $("password").value;
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
    return [...notes.values()].filter(n => (view === "trash" ? n.deleted : !n.deleted) && (!q || (n.title + " " + n.body).toLowerCase().includes(q)))
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
    const ta = document.createElement("textarea"); ta.className = "body"; ta.id = "noteBody"; ta.placeholder = "Начните писать…"; ta.value = n.body;
    ti.addEventListener("input", () => change(n.id, { title: ti.value }));
    ti.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ta.focus(); } });
    ta.addEventListener("input", () => change(n.id, { body: ta.value }));
    inner.append(ti, ta);
    if (window.T9) { T9.attach(ti); T9.attach(ta); }
  }
  function open(id) {
    currentId = id; $("app").classList.add("editing"); renderList(); renderEditor();
    const n = notes.get(id);
    if (matchMedia("(pointer:fine)").matches || (n && !n.title && !n.body)) setTimeout(() => { const el = n && !n.title && !n.body ? $("noteTitle") : $("noteBody"); el && el.focus(); }, 30);
  }
  function create() {
    if (view === "trash") { view = "all"; }
    const n = { id: uuid(), title: "", body: "", pinned: false, updated: Date.now(), deleted: null, dirty: true };
    notes.set(n.id, n); query = ""; $("search").value = ""; saveCache(); schedulePush(1500); open(n.id);
  }
  function closeEditor() {
    const n = currentId && notes.get(currentId);
    $("app").classList.remove("editing");
    if (n && !n.title.trim() && !n.body.trim() && !n.deleted) { notes.delete(n.id); saveCache(); sb.from("notes").delete().eq("id", n.id).then(() => {}); currentId = null; renderEditor(); }
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
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
