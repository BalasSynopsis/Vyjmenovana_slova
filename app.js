/* Expedice v0.1 — scaffold: store, content loader, router, map, island, word card.
   No network at runtime beyond same-origin files (all precached by sw.js).
   Content lives in content/<letter>.json; nothing here hard-codes a word. */
'use strict';

const ISLANDS = ['b', 'l', 'm', 'p', 's', 'v', 'z'];
const ACTIVE = ['b'];               // v0.1: only B is playable
const $app = document.getElementById('app');
const $crumb = document.getElementById('crumb');

/* ---------- store: IndexedDB key/value, localStorage fallback ---------- */
const Store = (() => {
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('expedice', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('log', { autoIncrement: true }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    }));
  }
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem('exp:' + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('exp:' + k, JSON.stringify(v)); } catch {} },
  };
  return {
    async get(k) { try { return await tx('kv', 'readonly', s => s.get(k)); } catch { return ls.get(k); } },
    async set(k, v) { try { await tx('kv', 'readwrite', s => s.put(v, k)); } catch { ls.set(k, v); } },
    async log(row) {
      try { await tx('log', 'readwrite', s => s.add(row)); }
      catch { const a = ls.get('log') || []; a.push(row); ls.set('log', a); }
    },
    async allLog() {
      try { return await tx('log', 'readonly', s => s.getAll()) || []; } catch { return ls.get('log') || []; }
    },
  };
})();

/* ---------- content loader ---------- */
const content = {};
async function loadIsland(letter) {
  if (content[letter]) return content[letter];
  const r = await fetch(`content/${letter}.json`);
  if (!r.ok) throw new Error('content ' + letter);
  const c = await r.json();
  c.byId = Object.fromEntries(c.words.map(w => [w.id, w]));
  content[letter] = c;
  return c;
}

/* ---------- progress + simple Leitner (boxes 1–4) ---------- */
const DAY = 86400000;
const INTERVAL = { 1: 0, 2: 1, 3: 3, 4: 7 };            // days until due again
const today = () => { const d = new Date(Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function getProgress() { return (await Store.get('progress')) || { seen: {}, words: {} }; }
async function saveProgress(p) { await Store.set('progress', p); }

// Leitner state is kept per WORD (items of a word rotate); contrast items per item.
// state: { box, last, days:[yyyy-mm-dd with a correct answer since last mistake] }
const srsKey = item => item.word_id === '_contrast' ? item.id : item.word_id;
function applyAnswer(p, item, correct) {
  // promote at most once per day, so a word can't jump 1→4 in one sitting
  const k = srsKey(item);
  const s = p.words[k] || { box: 1, last: 0, days: [] };
  if (correct) {
    if (isDue(s) && s.lastPromo !== today()) { s.box = Math.min(4, s.box + 1); s.lastPromo = today(); s.last = Date.now(); }
    if (!s.days.includes(today())) s.days.push(today());
  } else { s.box = 1; s.days = []; s.last = Date.now(); s.lastPromo = null; }
  p.words[k] = s;
  return s;
}
function isDue(s, now = Date.now()) { return !s || s.box === 1 || now - s.last >= INTERVAL[s.box] * DAY; }
function wordMastered(p, c, wordId) { const s = p.words[wordId]; return !!s && s.box === 4 && s.days.length >= 2; }

/* ---------- assets ---------- */
function placeholderImg(label, hue) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
    <polygon points='50,14 86,32 50,50 14,32' fill='hsl(${hue},55%,62%)'/>
    <polygon points='14,32 50,50 50,88 14,70' fill='hsl(${hue},55%,45%)'/>
    <polygon points='86,32 50,50 50,88 86,70' fill='hsl(${hue},55%,35%)'/>
    <text x='50' y='97' font-size='9' text-anchor='middle' fill='#555' font-family='sans-serif'>${label}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function imgTag(letter, id, idx) {
  return `<img src="assets/img/${letter}/${id}.webp" alt="" data-ph="${id}|${(idx * 47) % 360}" onerror="phImg(this)">`;
}
window.phImg = el => { el.onerror = null; const [l, h] = el.dataset.ph.split('|'); el.src = placeholderImg(l, h); };
let currentAudio = null;
function play(src, btn) {
  try { currentAudio && currentAudio.pause(); } catch {}
  const a = new Audio(src); currentAudio = a;
  a.play().catch(() => { if (btn) { btn.disabled = true; btn.title = 'zvuk zatím chybí'; } });
}

/* ---------- views ---------- */
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

async function viewMap() {
  $crumb.textContent = '';
  const p = await getProgress();
  const tiles = await Promise.all(ISLANDS.map(async L => {
    const active = ACTIVE.includes(L);
    let pct = 0;
    if (active) { const c = await loadIsland(L); pct = Math.round(100 * c.words.filter(w => wordMastered(p, c, w.id)).length / c.words.length); }
    return `<button class="isle ${active ? 'active' : 'locked'}" ${active ? `data-go="#/island/${L}"` : 'disabled'} aria-label="Ostrov ${L.toUpperCase()}">
      <span class="letter">${L.toUpperCase()}</span>${active ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}</button>`;
  }));
  $app.innerHTML = `<div class="world">${tiles.join('')}</div>`;
}

async function viewIsland(L) {
  const c = await loadIsland(L); const p = await getProgress();
  $crumb.textContent = c.island.name;
  const spots = c.words.map((w, n) => {
    const seen = !!p.seen[w.id], done = wordMastered(p, c, w.id);
    return `<button class="spot ${done ? '' : 'fog'} ${seen ? 'seen' : ''}" data-go="#/card/${L}/${w.id}">
      ${done ? `<img class="badge" src="assets/img/${L}/collectible.webp" alt="">` : ''}${imgTag(L, w.id, n)}<span class="w">${esc(w.word)}</span>${seen ? levelDots(p, w.id) : ''}</button>`;
  }).join('');
  const seenCount = c.words.filter(w => p.seen[w.id]).length;
  const doneCount = c.words.filter(w => wordMastered(p, c, w.id)).length;
  $app.innerHTML = `<button class="back" data-go="#/map">← mapa</button>
    <div class="island-head" style="background-image:url(assets/img/${L}/map.webp)">
      <p class="island-title">${esc(c.island.name)}</p>
      <p class="island-sub">${doneCount} / ${c.words.length} fosilií</p>
    </div>
    <div class="spots">${spots}</div>
    ${seenCount ? '' : '<p class="note">Otevři aspoň jednu kartičku – pak můžeš hrát.</p>'}
    <div class="actions"><button class="btn" data-go="#/play/${L}" ${seenCount ? '' : 'disabled'}>▶ Hra</button>
      <button class="btn" data-go="#/duel/${L}" ${seenCount ? '' : 'disabled'}>Souboj</button></div>
    <div class="actions"><button class="btn ghost" data-go="#/collection/${L}">Sbírka</button></div>`;
}

async function viewCard(L, id) {
  const c = await loadIsland(L); const w = c.byId[id];
  if (!w) return go('#/island/' + L);
  const p = await getProgress();
  if (!p.seen[id]) { p.seen[id] = Date.now(); await saveProgress(p); }
  $crumb.textContent = c.island.name;
  const idx = c.words.indexOf(w);
  $app.innerHTML = `<button class="back" data-go="#/island/${L}">← ostrov</button>
    <article class="card">
      <div class="pic">${imgTag(L, id, idx)}</div>
      <h1><button class="play" id="play" aria-label="Přehrát">▶</button>${esc(w.word)}</h1>
      <p class="meaning">${esc(w.meaning_cs)}</p>
      <p class="gloss">${esc(w.gloss_en)}</p>
      <p class="hook">${esc(w.hook_cs)}</p>
      ${w.related && w.related.length ? `<p class="rel">Rodina: <b>${w.related.map(esc).join(', ')}</b></p>` : ''}
    </article>`;
  const btn = document.getElementById('play');
  const src = `assets/audio/${L}/${id}-card.mp3`;
  btn.onclick = () => play(src, btn);
  play(src);
}

function levelDots(p, id) {
  const box = (p.words[id] && p.words[id].box) || 0;
  return `<span class="dots" aria-label="úroveň ${box} ze 4">${[1, 2, 3, 4].map(k => `<i class="${k <= box ? 'on' : ''}"></i>`).join('')}</span>`;
}

/* ---------- session builder ---------- */
const SESSION = 10;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr, n) => shuffle(arr.slice()).slice(0, n);
function maxRun(list) { let m = 0, r = 0, prev = null; for (const it of list) { r = it.answer === prev ? r + 1 : 1; prev = it.answer; m = Math.max(m, r); } return m; }

function buildSession(c, p, n = SESSION, useSrs = true) {
  const seenWords = new Set(Object.keys(p.seen).filter(id => c.byId[id]));
  const pool = c.items.filter(i => seenWords.has(i.word_id) || (i.word_id === '_contrast' && seenWords.size > 0));
  const due = i => !useSrs || isDue(p.words[srsKey(i)]);
  const pref = list => { const d = list.filter(due); return d.length >= 2 ? d : list; };
  const iItems = pref(pool.filter(i => i.answer === 'i'));
  const yItems = pref(pool.filter(i => i.answer === 'y'));
  // target 25–40 % i/í, varied each session
  let nI = Math.round(n * (0.25 + Math.random() * 0.15));
  nI = Math.min(nI, iItems.length); let nY = Math.min(n - nI, yItems.length);
  if (nI + nY < n) nI = Math.min(n - nY, iItems.length);
  // traps (homophone sentences) are worth more than plain contrast words
  const traps = iItems.filter(i => i.word_id !== '_contrast'), plain = iItems.filter(i => i.word_id === '_contrast');
  const nTrap = Math.min(traps.length, Math.ceil(nI * 0.6));
  const chosenI = pick(traps, nTrap).concat(pick(plain, nI - nTrap));
  // one y item per word first, spread across words
  const byWord = {}; yItems.forEach(i => (byWord[i.word_id] = byWord[i.word_id] || []).push(i));
  const chosenY = []; let rounds = 0;
  while (chosenY.length < nY && rounds++ < 20) for (const w of shuffle(Object.keys(byWord))) {
    const left = byWord[w].filter(i => !chosenY.includes(i)); if (left.length && chosenY.length < nY) chosenY.push(pick(left, 1)[0]);
  }
  let list = chosenI.concat(chosenY);
  for (let t = 0; t < 50 && (t === 0 || maxRun(list) > 4); t++) shuffle(list);
  return list;
}

/* ---------- swipe / duel ---------- */
function renderText(item, revealed) {
  const k = item.text.indexOf('_');
  const letter = revealed ? `<span class="slot ${item.answer}">${esc(item.full.charAt(k))}</span>` : '<span class="slot">?</span>';
  return esc(item.text.slice(0, k)) + letter + esc(item.text.slice(k + 1));
}

async function viewPlay(L, mode) {
  const c = await loadIsland(L); const p = await getProgress();
  const list = buildSession(c, p, SESSION, mode === 'swipe');
  if (!list.length) return go('#/island/' + L);
  const players = mode === 'duel' ? ['Hráč', 'Rodič'] : [null];
  const scores = [];
  for (let pi = 0; pi < players.length; pi++) {
    if (players[pi]) await interstitial(`${players[pi]} je na řadě`, 'Podej telefon a klepni na Start.', 'Start');
    scores.push(await runRound(L, c, list, mode, pi === 0));
  }
  if (mode === 'duel') {
    const [a, b] = scores; const res = a === b ? 'Remíza!' : a > b ? 'Vyhrává hráč!' : 'Vyhrává rodič!';
    $app.innerHTML = `<div class="done"><h2>${res}</h2><p class="big">Hráč ${a} : ${b} Rodič</p>
      <div class="actions"><button class="btn" data-go="#/duel/${L}">Znovu</button><button class="btn ghost" data-go="#/island/${L}">Ostrov</button></div></div>`;
  }
}

function interstitial(title, sub, btn) {
  return new Promise(res => {
    $app.innerHTML = `<div class="done"><h2>${esc(title)}</h2><p>${esc(sub)}</p><div class="actions"><button class="btn" id="go">${esc(btn)}</button></div></div>`;
    document.getElementById('go').onclick = res;
  });
}

async function runRound(L, c, list, mode, logIt) {
  let score = 0; const newlyMastered = [];
  const before = JSON.parse(JSON.stringify((await getProgress()).words));
  for (let n = 0; n < list.length; n++) {
    const item = list[n];
    const correct = await askItem(L, c, item, n, list.length);
    if (correct) score++;
    if (logIt) {
      const p = await getProgress();
      const wasMastered = item.word_id !== '_contrast' && wordMastered(p, c, item.word_id);
      await Store.log({ timestamp: new Date().toISOString(), item_id: item.id, word_id: item.word_id, mode,
        presented: 'both', card_seen_before: p.seen[item.word_id] ? 'y' : 'n', answer: item._given, correct: correct ? 'y' : 'n', response_ms: item._ms });
      if (mode === 'swipe') {
        applyAnswer(p, item, correct); await saveProgress(p);
        if (!wasMastered && item.word_id !== '_contrast' && wordMastered(p, c, item.word_id)) newlyMastered.push(item.word_id);
      }
    }
  }
  if (mode === 'swipe') {
    const p = await getProgress();
    const allDone = c.words.every(w => wordMastered(p, c, w.id));
    const ups = c.words.filter(w => { const a = (p.words[w.id] || {}).box || 0; return a > 1 && a > ((before[w.id] || {}).box || 0) && !newlyMastered.includes(w.id); })
      .map(w => `<li>${esc(w.word)} ${levelDots(p, w.id)}</li>`).join('');
    const got = newlyMastered.map(id => `<li><img src="assets/img/${L}/collectible.webp" alt=""> ${esc(c.byId[id].word)}</li>`).join('');
    $app.innerHTML = `<div class="done"><h2>Hotovo!</h2><p class="big">${score} / ${list.length}</p>
      ${ups ? `<p>Slova o úroveň výš:</p><ul class="ups">${ups}</ul>` : ''}
      ${got ? `<p>Nové fosilie:</p><ul class="got">${got}</ul>` : '<p>Fosilii získáš, když má slovo 4 tečky a umíš ho víc dní po sobě.</p>'}
      ${allDone ? `<p><b>Ostrov je hotový! Strážce se připojil do sbírky.</b></p>` : ''}
      <div class="actions"><button class="btn" data-go="#/play/${L}">Ještě jednou</button><button class="btn ghost" data-go="#/island/${L}">Ostrov</button></div></div>`;
  }
  return score;
}

function askItem(L, c, item, n, total) {
  return new Promise(resolve => {
    $app.innerHTML = `<div class="game"><button class="back" data-go="#/island/${L}">← konec</button>
      <div class="progress"><i style="width:${Math.round(100 * n / total)}%"></i></div>
      <div class="qcard" id="qcard">
        <button class="play" id="replay" aria-label="Přehrát znovu">▶</button>
        <p class="qtext" id="qtext">${renderText(item, false)}</p>
      </div>
      <div class="answers">
        <button class="ans i" id="ai">i / í</button>
        <button class="ans y" id="ay">y / ý</button>
      </div>
      <p class="hint">Přejeď prstem doleva (i) nebo doprava (y).</p>
    </div>`;
    const src = `assets/audio/${L}/${item.audio}`;
    const btn = document.getElementById('replay'); btn.onclick = () => play(src, btn);
    play(src);
    const t0 = performance.now(); let done = false;
    const answer = given => {
      if (done) return; done = true;
      item._given = given; item._ms = Math.round(performance.now() - t0);
      const ok = given === item.answer;
      const card = document.getElementById('qcard');
      card.classList.add(ok ? 'ok' : 'bad', given === 'i' ? 'went-left' : 'went-right');
      document.getElementById('qtext').innerHTML = renderText(item, true);
      document.querySelector('.answers').innerHTML = `<p class="fb">${ok ? 'Správně!' : 'Tady je správně: ' + esc(item.full)}</p>
        <button class="btn" id="next">Dál</button>`;
      document.getElementById('next').onclick = () => resolve(ok);
    };
    document.getElementById('ai').onclick = () => answer('i');
    document.getElementById('ay').onclick = () => answer('y');
    // swipe
    const card = document.getElementById('qcard'); let x0 = null;
    card.addEventListener('pointerdown', e => { x0 = e.clientX; card.setPointerCapture(e.pointerId); });
    card.addEventListener('pointermove', e => { if (x0 !== null && !done) card.style.transform = `translateX(${(e.clientX - x0) * 0.6}px) rotate(${(e.clientX - x0) * 0.03}deg)`; });
    const end = e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; card.style.transform = '';
      if (!done && Math.abs(dx) > 70) answer(dx < 0 ? 'i' : 'y'); };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', () => { x0 = null; card.style.transform = ''; });
  });
}

async function viewCollection(L) {
  const c = await loadIsland(L); const p = await getProgress();
  $crumb.textContent = c.island.name;
  const all = c.words.every(w => wordMastered(p, c, w.id));
  const items = c.words.map(w => { const m = wordMastered(p, c, w.id);
    return `<div class="coll ${m ? '' : 'locked'}"><img src="assets/img/${L}/collectible.webp" alt=""><span>${m ? esc(w.word) : '?'}</span></div>`; }).join('');
  $app.innerHTML = `<button class="back" data-go="#/island/${L}">← ostrov</button>
    <div class="card"><div class="pic guardian ${all ? '' : 'locked'}"><img src="assets/img/${L}/guardian.webp" alt=""></div>
      <h1>${all ? esc(c.island.guardian) : 'Strážce spí…'}</h1>
      <p class="gloss">${all ? 'Ostrov je tvůj!' : 'Probudí se, až najdeš všech ' + c.words.length + ' fosilií.'}</p></div>
    <div class="colls">${items}</div>`;
}

/* ---------- parent screen + CSV ---------- */
const CSV_COLS = ['timestamp', 'item_id', 'word_id', 'mode', 'presented', 'card_seen_before', 'answer', 'correct', 'response_ms'];
function toCsv(rows) {
  const q = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [CSV_COLS.join(',')].concat(rows.map(r => CSV_COLS.map(k => q(r[k])).join(','))).join('\r\n') + '\r\n';
}
async function viewParent() {
  $crumb.textContent = 'rodič';
  const log = await Store.allLog();
  const sw = log.filter(r => r.mode === 'swipe'), ok = sw.filter(r => r.correct === 'y').length;
  $app.innerHTML = `<button class="back" data-go="#/map">← mapa</button>
    <div class="parent"><h2>Rodičovská sekce</h2>
      <p>Odpovědí celkem: <b>${log.length}</b> (hra ${sw.length}, souboj ${log.length - sw.length})</p>
      <p>Úspěšnost ve hře: <b>${sw.length ? Math.round(100 * ok / sw.length) : 0} %</b></p>
      <div class="actions"><button class="btn" id="csv" ${log.length ? '' : 'disabled'}>Export CSV</button></div>
      <p class="gloss">Data zůstávají jen v tomto telefonu.</p></div>`;
  document.getElementById('csv').onclick = async () => {
    const name = `expedice-log-${today()}.csv`;
    const blob = new Blob([toCsv(log)], { type: 'text/csv;charset=utf-8' });
    try {
      const file = new File([blob], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
}

/* ---------- router ---------- */
function go(h) { if (location.hash === h) route(); else location.hash = h; }
async function route() {
  const parts = (location.hash || '#/map').slice(2).split('/');
  try {
    if (parts[0] === 'island' && ACTIVE.includes(parts[1])) await viewIsland(parts[1]);
    else if (parts[0] === 'card' && ACTIVE.includes(parts[1])) await viewCard(parts[1], parts[2]);
    else if (parts[0] === 'parent') await viewParent();
    else if (parts[0] === 'play' && ACTIVE.includes(parts[1])) await viewPlay(parts[1], 'swipe');
    else if (parts[0] === 'duel' && ACTIVE.includes(parts[1])) await viewPlay(parts[1], 'duel');
    else if (parts[0] === 'collection' && ACTIVE.includes(parts[1])) await viewCollection(parts[1]);
    else await viewMap();
  } catch (e) {
    $app.innerHTML = `<p class="note">Něco se nenačetlo. Zkus to znovu.</p>`; console.error(e);
  }
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => { const t = e.target.closest('[data-go]'); if (t) go(t.dataset.go); });
window.addEventListener('hashchange', route);

/* hidden parent entry: long-press the logo */
(() => {
  const logo = document.getElementById('logo'); let t = null;
  const start = () => { t = setTimeout(() => go('#/parent'), 1200); };
  const stop = () => clearTimeout(t);
  logo.addEventListener('pointerdown', start); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => logo.addEventListener(ev, stop));
  logo.addEventListener('contextmenu', e => e.preventDefault());
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
