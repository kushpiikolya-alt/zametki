// Т9 для «Заметок»: подсказки слов, автоисправление, раскладка, заглавные буквы.
(function () {
  const RU = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя", EN = "abcdefghijklmnopqrstuvwxyz";
  const LAT = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`", CYR = "йцукенгшщзхъфывапролджэячсмитьбюё";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const rank = new Map();
  const D = window.T9DICT || { ru: "", en: "" };
  D.ru.split(" ").forEach((w, i) => { if (w && !rank.has(w)) rank.set(w, 1e6 - i); });
  D.en.split(" ").forEach((w, i) => { if (w && !rank.has(w)) rank.set(w, 4e5 - i * 2); });
  const sorted = [...rank.keys()].sort();

  const user = new Map();            // слова пользователя -> сколько раз встречались
  const learned = new Set(lsGet("t9.learned", []));
  learned.forEach(w => user.set(w, (user.get(w) || 0) + 3));
  function learnText(t) {
    (t.toLowerCase().match(/[a-zа-яё]+(?:-[a-zа-яё]+)?/g) || []).forEach(w => { if (w.length > 1) user.set(w, (user.get(w) || 0) + 1); });
  }
  lsGet("notes.v1", []).forEach(n => learnText((n.title || "") + " " + (n.body || "")));

  const touch = typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches;
  let on = lsGet("t9.on", !touch);
  const known = w => rank.has(w) || user.has(w);
  const score = w => (rank.get(w) || 0) + (user.get(w) || 0) * 2e5;

  function edits1(w, A) {
    const out = new Set();
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) out.add(a + b.slice(1));
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
      for (const c of A) { if (b) out.add(a + c + b.slice(1)); out.add(a + c + b); }
    }
    return out;
  }
  function keepCase(src, w) {
    if (src.length > 1 && src === src.toUpperCase()) return w.toUpperCase();
    if (src[0] !== src[0].toLowerCase()) return w[0].toUpperCase() + w.slice(1);
    return w;
  }
  const toRu = w => [...w].map(c => { const i = LAT.indexOf(c); return i < 0 ? c : CYR[i]; }).join("");

  function correct(word) {
    const w = word.toLowerCase();
    if (w.length < 2 || /\d/.test(w) || known(w) || learned.has(w)) return null;
    if (/^[a-z;'\[\],.`]+$/.test(w)) {           // набрано не в той раскладке
      const r = toRu(w);
      if (known(r) && !rank.has(w)) return keepCase(word, r);
    }
    if (w.length < 3) return null;
    const A = /[а-яё]/.test(w) ? RU : EN;
    let best = null, bs = 0;
    for (const c of edits1(w, A)) { if (known(c)) { const s = score(c); if (s > bs) { bs = s; best = c; } } }
    if (!best && w.length >= 6) {
      const e1 = edits1(w, A);
      for (const a of e1) for (let i = 0; i < a.length; i++) {
        const c = a.slice(0, i) + a.slice(i + 1);   // удаление+любая правка: самые частые опечатки
        if (known(c)) { const s = score(c); if (s > bs) { bs = s; best = c; } }
        if (i < a.length - 1) { const t = a.slice(0, i) + a[i + 1] + a[i] + a.slice(i + 2); if (known(t)) { const s = score(t); if (s > bs) { bs = s; best = t; } } }
      }
    }
    return best ? keepCase(word, best) : null;
  }

  function suggest(word) {
    const p = word.toLowerCase();
    if (!p) return [];
    const found = new Map();
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < p) lo = m + 1; else hi = m; }
    for (let i = lo, n = 0; i < sorted.length && n < 6000 && sorted[i].startsWith(p); i++, n++) found.set(sorted[i], score(sorted[i]));
    for (const [w] of user) if (w.startsWith(p)) found.set(w, score(w));
    const fix = correct(word);
    let list = [...found.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    if (fix && list.length < 3) list = [fix.toLowerCase(), ...list.filter(x => x !== fix.toLowerCase())];
    return list.slice(0, 3).map(w => keepCase(word, w));
  }

  // ---------- работа с полем ввода (input, textarea и форматируемый текст) ----------
  let bar, btn, busy = false, last = null, active = null, sugg = [], noteTimer;
  const WORD = /[A-Za-zА-Яа-яЁё;'\[\],.`-]*$/;
  const LETTERS = /[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]*$/;
  const isRich = el => el.isContentEditable;
  const BLOCK = /^(DIV|P|LI|H1|H2|H3|BLOCKQUOTE|PRE)$/;

  // текст до курсора (в пределах абзаца) и после курсора (в пределах текстового узла)
  function ctx(el) {
    if (!isRich(el)) {
      if (el.selectionStart !== el.selectionEnd) return null;
      const pos = el.selectionStart;
      return { before: el.value.slice(0, pos), after: el.value.slice(pos), nodeBefore: el.value.slice(0, pos) };
    }
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || !el.contains(sel.focusNode)) return null;
    const node = sel.focusNode, off = sel.focusOffset;
    let block = node.nodeType === 1 ? node : node.parentNode;
    while (block && block !== el && !BLOCK.test(block.nodeName)) block = block.parentNode;
    const r = document.createRange(); r.setStart(block || el, 0); r.setEnd(node, off);
    const before = r.toString();
    const isText = node.nodeType === 3;
    return { before, after: isText ? node.data.slice(off) : "", nodeBefore: isText ? node.data.slice(0, off) : "" };
  }
  // заменить текст между (курсор - fromBack) и (курсор - toBack); курсор остаётся там же относительно текста
  function replaceBack(el, fromBack, toBack, text, extraAfter) {
    busy = true; extraAfter = extraAfter || 0;
    try {
      if (!isRich(el)) {
        const pos = el.selectionStart, start = pos - fromBack, end = pos - toBack + extraAfter;
        el.focus(); el.setSelectionRange(start, end);
        if (!document.execCommand("insertText", false, text)) el.setRangeText(text, start, end, "end");
        const c = start + text.length + toBack; el.setSelectionRange(c, c);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        const sel = getSelection(), node = sel.focusNode, off = sel.focusOffset;
        if (node.nodeType !== 3 || off < fromBack) return false;
        const r = document.createRange();
        r.setStart(node, off - fromBack); r.setEnd(node, Math.min(node.data.length, off - toBack + extraAfter));
        sel.removeAllRanges(); sel.addRange(r);
        document.execCommand("insertText", false, text);
        for (let k = 0; k < toBack; k++) sel.modify("move", "forward", "character");
      }
      return true;
    } finally { busy = false; }
  }
  function currentWord(el) {
    const c = ctx(el); if (!c) return null;
    const m = c.nodeBefore.match(LETTERS);
    return m ? { word: m[0], after: c.after } : null;
  }

  function render(note) {
    if (!bar) return;
    bar.innerHTML = "";
    if (!on || !active) { bar.hidden = true; return; }
    if (note) {
      const s = document.createElement("span"); s.className = "t9note"; s.textContent = note; bar.append(s);
    }
    sugg.forEach((w, i) => {
      const b = document.createElement("button"); b.className = "t9chip" + (i === 0 ? " first" : ""); b.type = "button";
      b.textContent = w; b.title = i === 0 ? "Tab" : "Alt+" + (i + 1);
      b.onmousedown = e => { e.preventDefault(); accept(i); };
      bar.append(b);
    });
    if (sugg.length) { const h = document.createElement("span"); h.className = "t9hint"; h.textContent = "Tab — вставить"; bar.append(h); }
    bar.hidden = !note && !sugg.length;
  }
  function refresh() {
    if (!active) return;
    const cw = currentWord(active);
    sugg = cw && cw.word.length >= 1 ? suggest(cw.word) : [];
    render();
  }
  function accept(i) {
    const el = active, cw = el && currentWord(el);
    if (!cw || !sugg[i]) return;
    const tail = (cw.after.match(/^[A-Za-zА-Яа-яЁё-]*/) || [""])[0];
    const space = /^\s/.test(cw.after.slice(tail.length)) ? "" : " ";
    replaceBack(el, cw.word.length, 0, sugg[i] + space, tail.length);
    user.set(sugg[i].toLowerCase(), (user.get(sugg[i].toLowerCase()) || 0) + 1);
    sugg = []; render();
  }

  function onInput(e) {
    if (busy || !on) return;
    const el = e.currentTarget;
    if (e.inputType === "insertText" && e.data) {
      const ch = e.data, c = ctx(el);
      if (!c) { last = null; return refresh(); }
      // заглавная в начале предложения
      if (ch.length === 1 && /[a-zа-яё]/.test(ch)) {
        const before = c.before.slice(0, -1);
        if (/(^|[.!?…]\s+|\n\s*)$/.test(before.replace(/ /g, " "))) replaceBack(el, 1, 0, ch.toUpperCase());
      }
      // автоисправление после пробела или знака препинания
      if (/^[\s .,!?;:)…]$/.test(ch)) {
        const before = c.nodeBefore.slice(0, -1);
        const full = (before.match(WORD) || [""])[0];
        let raw = (before.match(LETTERS) || [""])[0], fixed = null;
        if (full !== raw && /^[a-z;'\[\],.`]+$/i.test(full) && !/^[.,!?;:]$/.test(ch)) {
          const r = toRu(full.toLowerCase());
          if (known(r)) { raw = full; fixed = keepCase(full, r); }
        }
        if (raw && raw.length >= 2) {
          if (!fixed) fixed = correct(raw);
          if (fixed && fixed !== raw && replaceBack(el, raw.length + 1, 1, fixed)) {
            last = { el, fixed, raw, delim: ch };
            sugg = []; render(raw + " → " + fixed + "  ·  Backspace — вернуть");
            clearTimeout(noteTimer); noteTimer = setTimeout(() => { if (last) { last = null; render(); } }, 3500);
            return;
          }
        }
        last = null;
      } else last = null;
    } else last = null;
    refresh();
  }

  function onKey(e) {
    if (!on) return;
    const el = e.currentTarget;
    if (e.key === "Backspace" && last && last.el === el) {
      const c = ctx(el), tailTxt = last.fixed + last.delim;
      if (c && c.nodeBefore.endsWith(tailTxt)) {
        e.preventDefault();
        const w = last.raw.toLowerCase(); learned.add(w); lsSet("t9.learned", [...learned]); user.set(w, (user.get(w) || 0) + 3);
        replaceBack(el, tailTxt.length, 0, last.raw);
        last = null; refresh(); return;
      }
    }
    if (e.key === "Tab" && !e.shiftKey && sugg.length && currentWord(el)) { e.preventDefault(); accept(0); return; }
    if (e.altKey && (e.key === "2" || e.key === "3") && sugg[+e.key - 1]) { e.preventDefault(); accept(+e.key - 1); return; }
    if (e.key === "Escape" && sugg.length) { e.stopPropagation(); sugg = []; render(); }
  }

  function setOn(v) {
    on = v; lsSet("t9.on", v);
    if (btn) { btn.textContent = v ? "Т9: вкл" : "Т9: выкл"; btn.classList.toggle("on", v); }
    if (!v) { sugg = []; render(); }
  }

  window.T9 = {
    attach(el) {
      el.spellcheck = true; el.lang = "ru";
      if (!isRich(el)) el.setAttribute("autocomplete", "off");
      el.addEventListener("input", onInput);
      el.addEventListener("keydown", onKey);
      el.addEventListener("focus", () => { active = el; refresh(); });
      el.addEventListener("click", () => { active = el; refresh(); });
      el.addEventListener("keyup", e => { if (/^Arrow|Home|End/.test(e.key)) refresh(); });
      el.addEventListener("blur", () => setTimeout(() => { if (!el.contains(document.activeElement) && document.activeElement !== el && active === el) { active = null; sugg = []; render(); } }, 150));
    },
    init() {
      bar = document.getElementById("t9bar"); btn = document.getElementById("t9Btn");
      if (btn) btn.onclick = () => setOn(!on);
      setOn(on);
    },
    learnText, correct, suggest
  };
})();
