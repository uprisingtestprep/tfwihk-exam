const ACCESS_CODE = "TFWIHK9000";
const STORE = "tfwihk_state_v1";
const WRITTEN_SECONDS = 240 * 60;
const MIN_PER_POINT = 2.4;
const ORAL_PHASES = [
  { key: "prep", label: "Vorbereitung (alle Hilfsmittel erlaubt)", seconds: 30 * 60 },
  { key: "pres", label: "Präsentation (keine Hilfsmittel)", seconds: 15 * 60 },
  { key: "talk", label: "Prüfungsgespräch (keine Hilfsmittel)", seconds: 20 * 60 },
];
const DOMAIN_LABELS = {
  absatz_material_logistik: "Absatz-, Materialwirtschaft und Logistik",
  produktion: "Produktionsplanung, -steuerung und -kontrolle",
  qualitaet_umwelt_arbeitsschutz: "Qualitäts- und Umweltmanagement sowie Arbeitsschutz",
  fuehrung: "Führung und Zusammenarbeit",
};

let CASES = [], ORAL = [];
let mode = null;            // "case" | "mock" | "oral"
let current = null;         // case, oral scenario, or mock {mock, items}
let timer = { iv: null, left: 0, running: false, done: false, phase: 0 };

function $(id) { return document.getElementById(id); }
function showScreen(id) {
  ["gate-screen", "mode-screen", "list-screen", "mockpick-screen", "work-screen"].forEach(s => { $(s).style.display = s === id ? "" : "none"; });
  window.scrollTo(0, 0);
}
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function pts(p) { return (Math.round(p * 100) / 100).toString().replace(".", ","); }
function fmt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function loadState() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
function saveState(st) { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) {} }

// ---------- gate ----------
function checkCode() {
  if ($("access-code-input").value.trim().toUpperCase() === ACCESS_CODE) {
    try { sessionStorage.setItem("tfwihk_access", "1"); } catch (e) {}
    showScreen("mode-screen");
  } else { $("gate-error").textContent = "Falscher Zugangscode. Bitte prüfen Sie Ihr Buch oder Ihre Produktseite."; }
}
$("gate-submit").addEventListener("click", checkCode);
$("access-code-input").addEventListener("keydown", e => { if (e.key === "Enter") checkCode(); });

// ---------- data ----------
async function ensureData() {
  if (!CASES.length) CASES = await (await fetch("cases.json")).json();
  if (!ORAL.length) ORAL = await (await fetch("oral.json")).json();
}

// ---------- modes ----------
$("mode-cases").addEventListener("click", () => openList("case"));
$("mode-oral").addEventListener("click", () => openList("oral"));
$("mode-mock").addEventListener("click", async () => {
  try { await ensureData(); } catch (e) { alert("Die Inhalte konnten nicht geladen werden. Bitte Seite neu laden."); return; }
  const box = $("mock-buttons"); box.innerHTML = "";
  [...new Set(CASES.map(c => c.mock))].sort((a, b) => a - b).forEach(m => {
    const first = CASES.find(c => c.mock === m && c.position === 1);
    const b = document.createElement("button"); b.className = "btn btn-primary";
    b.textContent = `Mock ${m}: ${first && first.company ? first.company : ""}`;
    b.addEventListener("click", () => startMock(m)); box.appendChild(b);
  });
  showScreen("mockpick-screen");
});
$("back-from-list").addEventListener("click", e => { e.preventDefault(); showScreen("mode-screen"); });
$("back-from-mockpick").addEventListener("click", () => showScreen("mode-screen"));
$("back-from-work").addEventListener("click", () => {
  if (timer.running && !confirm("Die Uhr läuft noch. Wirklich zurück?")) return;
  stopTimer(); showScreen(mode === "oral" ? "list-screen" : (mode === "mock" ? "mockpick-screen" : "list-screen"));
});

async function openList(m) {
  try { await ensureData(); } catch (e) { alert("Die Inhalte konnten nicht geladen werden. Bitte Seite neu laden."); return; }
  mode = m;
  $("list-title").textContent = m === "case" ? "60 Teilaufgaben" : "40 Fachgespräche";
  const mockSel = $("filter-mock"), domSel = $("filter-domain");
  mockSel.innerHTML = ""; domSel.innerHTML = "";
  const first = document.createElement("option"); first.value = ""; first.textContent = m === "case" ? "Alle Mocks" : "Alle Runden"; mockSel.appendChild(first);
  const src = m === "case" ? CASES : ORAL;
  [...new Set(src.map(c => m === "case" ? c.mock : c.set))].sort((a, b) => a - b).forEach(v => {
    const o = document.createElement("option"); o.value = v; o.textContent = (m === "case" ? "Mock " : "Runde ") + v; mockSel.appendChild(o);
  });
  const d0 = document.createElement("option"); d0.value = ""; d0.textContent = "Alle Handlungsbereiche"; domSel.appendChild(d0);
  Object.keys(DOMAIN_LABELS).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = DOMAIN_LABELS[k]; domSel.appendChild(o); });
  mockSel.onchange = domSel.onchange = renderList;
  renderList(); showScreen("list-screen");
}
function renderList() {
  const m = $("filter-mock").value, d = $("filter-domain").value;
  const src = (mode === "case" ? CASES : ORAL).filter(c => (!m || String(mode === "case" ? c.mock : c.set) === m) && (!d || c.domain === d));
  const st = loadState();
  $("list-count").textContent = src.length + " Einträge";
  const box = $("item-list"); box.innerHTML = "";
  src.forEach(c => {
    const done = st[`${mode}_${c.id}`];
    const row = document.createElement("div"); row.className = "station-row";
    row.innerHTML = `<div><strong>${mode === "case" ? "Teilaufgabe" : "Fachgespräch"} ${c.id}: ${esc(c.title)}</strong>
      <div class="sub">${esc(DOMAIN_LABELS[c.domain] || c.domain)}${mode === "case" ? ` &middot; Mock ${c.mock} &middot; ${pts(c.points)} Punkte` : ` &middot; Runde ${c.set}`}</div></div>
      <div class="sub">${done ? esc(done) : ""}</div>`;
    row.addEventListener("click", () => mode === "case" ? startCase(c) : startOral(c));
    box.appendChild(row);
  });
}

// ---------- timer ----------
function stopTimer() { clearInterval(timer.iv); timer.running = false; }
function paintTimer() {
  const el = $("timer-display"); el.textContent = fmt(Math.max(0, timer.left));
  el.classList.toggle("amber", timer.left <= 600 && timer.left > 180);
  el.classList.toggle("red", timer.left <= 180);
}
function setupTimer(seconds, heading, sub) {
  stopTimer(); timer.left = seconds; timer.done = false; timer.running = false;
  $("timer-heading").textContent = heading; $("timer-sub").textContent = sub || "";
  $("timer-label").textContent = "Bereit"; $("timer-start").textContent = "Uhr starten"; $("timer-start").disabled = false;
  $("timer-next").classList.add("hidden"); paintTimer();
  timer.total = seconds;
}
function runTimer(onEnd) {
  if (timer.running) return;
  timer.running = true; $("timer-label").textContent = "Läuft"; $("timer-start").disabled = true;
  timer.iv = setInterval(() => {
    timer.left -= 1; paintTimer();
    if (timer.left <= 0) { stopTimer(); timer.done = true; $("timer-label").textContent = "Zeit abgelaufen"; onEnd && onEnd(); }
  }, 1000);
}
$("timer-reset").addEventListener("click", () => {
  if (!current) return;
  if (mode === "oral") { startOral(current.item); } else if (mode === "mock") { startMock(current.mock); } else { startCase(current.item); }
});

// ---------- shared renderers ----------
function exhibitsHtml(ex) {
  return (ex || []).map(x => `<p class="label">${esc(x.title)}</p><table class="grid"><thead><tr>${x.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${x.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>${x.note ? `<p class="note">${esc(x.note)}</p>` : ""}`).join("");
}
function tasksHtml(c) {
  return `<p class="label">Aufgaben</p>` + c.tasks.map(t => `<p><strong>${esc(t.label)})</strong> ${esc(t.prompt)} <span class="tag">${pts(t.points)} P</span></p>`).join("");
}
function caseHtml(c, withCompany) {
  return `${withCompany && withCompany.company_context ? `<section class="panel"><h2>Das Unternehmen</h2><p>${esc(withCompany.company_context)}</p></section>` : ""}
  <section class="panel"><h2>Teilaufgabe ${c.id}: ${esc(c.title)}</h2>
  <p class="note">${esc(DOMAIN_LABELS[c.domain] || c.domain)} &middot; ${pts(c.points)} Punkte &middot; etwa ${Math.round(c.points * MIN_PER_POINT)} Minuten</p>
  <p class="label">Ausgangslage</p><p>${esc(c.situation)}</p>${exhibitsHtml(c.exhibits)}${tasksHtml(c)}
  <p class="label">Notizen</p><textarea rows="5" placeholder="Rechnen und lösen Sie bitte auf Papier. Hier nur Stichpunkte."></textarea></section>`;
}
function reviewTaskHtml(c) {
  return c.tasks.map((t, ti) => `<div class="task"><h3>Aufgabe ${esc(t.label)} (${pts(t.points)} Punkte)</h3><p><strong>${esc(t.prompt)}</strong></p>
  <p class="label">Musterlösung</p>${t.model_answer.split("\n").map(l => `<p>${esc(l)}</p>`).join("")}
  <p class="label">Bewertungsraster: Haken setzen, was Sie geleistet haben</p>
  ${t.marking.map((m, mi) => `<label class="checkrow"><input type="checkbox" data-case="${c.id}" data-t="${ti}" data-m="${mi}" data-p="${m.points}"><span>${esc(m.point)} <span class="tag">${pts(m.points)} P</span></span></label>`).join("")}</div>`).join("")
  + `<div class="label">Häufige Prüflingsfehler</div><p>${esc(c.common_errors)}</p><div class="label">Hinweise der Prüfer</div><p>${esc(c.examiner_notes)}</p>`;
}
function sumChecked(root, caseId) {
  let s = 0; root.querySelectorAll(`input[data-case="${caseId}"]:checked`).forEach(i => { s += parseFloat(i.dataset.p); }); return s;
}

// ---------- single written task ----------
function startCase(c) {
  mode = "case"; current = { item: c };
  $("work-title").textContent = `Teilaufgabe ${c.id}`;
  $("work-badge").textContent = DOMAIN_LABELS[c.domain] || c.domain;
  const ctxHolder = CASES.find(x => x.mock === c.mock && x.position === 1);
  $("work-body").innerHTML = caseHtml(c, ctxHolder);
  const secs = Math.round(c.points * MIN_PER_POINT * 60);
  setupTimer(secs, `Uhr: ${Math.round(secs / 60)} Minuten`, "etwa 2,4 Minuten je Punkt wie in der echten Prüfung");
  $("timer-start").onclick = () => runTimer();
  $("reveal-warn").textContent = ""; $("answer-section").style.display = "none";
  $("reveal-btn").onclick = () => {
    if (!timer.done && timer.running && !confirm("Die Uhr läuft noch. Wirklich schon zeigen?")) return;
    stopTimer();
    const a = $("answer-section"); a.style.display = "";
    a.innerHTML = `<h2>Bewerten Sie sich</h2><p class="note">Das Punkteraster ist das Übungsraster des Buches, kein amtliches Raster.</p>${reviewTaskHtml(c)}<div class="score-box" id="score-box"></div>`;
    const upd = () => { const s = sumChecked(a, c.id); const sb = $("score-box"); sb.textContent = `Ihre Punkte: ${pts(s)} von ${pts(c.points)} (${Math.round(100 * s / c.points)} Prozent). Die gesetzliche Grenze liegt bei 50 Prozent der Punkte.`; sb.className = "score-box " + (s / c.points >= 0.5 ? "pass" : "fail");
      const st = loadState(); st[`case_${c.id}`] = `${pts(s)}/${pts(c.points)}`; saveState(st); };
    a.querySelectorAll("input").forEach(i => i.addEventListener("change", upd)); upd();
    a.scrollIntoView({ behavior: "smooth" });
  };
  showScreen("work-screen");
}

// ---------- full mock ----------
function startMock(m) {
  mode = "mock";
  const items = CASES.filter(c => c.mock === m).sort((a, b) => a.position - b.position);
  current = { mock: m, items };
  $("work-title").textContent = `Situationsaufgabe Mock ${m}: ${items[0].company || ""}`;
  $("work-badge").textContent = `6 Teilaufgaben, ${items.reduce((s, c) => s + c.points, 0)} Übungspunkte`;
  $("work-body").innerHTML = `<section class="panel"><h2>Das Unternehmen</h2><p>${esc(items[0].company_context)}</p>
    <p class="note">Bearbeiten Sie die Teilaufgaben in beliebiger Reihenfolge. Notieren Sie Lösungen auf Papier.</p></section>` +
    items.map(c => caseHtml(c, null).replace(/<section class="panel"><h2>Teilaufgabe/, '<section class="panel"><h2>Teilaufgabe')).join("");
  setupTimer(WRITTEN_SECONDS, "Uhr: 240 Minuten", "Die Uhr läuft ohne Pause, wie in der Prüfung.");
  $("timer-start").onclick = () => runTimer();
  $("reveal-warn").textContent = "Erst nach Ablauf der Uhr oder wenn Sie fertig sind.";
  $("answer-section").style.display = "none";
  $("reveal-btn").onclick = () => {
    if (!timer.done && timer.running && !confirm("Die Uhr läuft noch. Wirklich beenden und bewerten?")) return;
    stopTimer();
    const a = $("answer-section"); a.style.display = "";
    a.innerHTML = `<h2>Bewerten Sie sich: Mock ${m}</h2><div class="score-box" id="score-box"></div>` + items.map(c => `<h3 style="margin-top:2rem">Teilaufgabe ${c.id}: ${esc(c.title)}</h3>${reviewTaskHtml(c)}`).join("") + `<div class="score-box" id="score-box2"></div>`;
    const total = items.reduce((s, c) => s + c.points, 0);
    const upd = () => {
      let s = 0; items.forEach(c => { s += sumChecked(a, c.id); });
      const txt = `Ihre Gesamtpunkte: ${pts(s)} von ${total}. ${s >= 50 ? "Sie liegen auf oder über der 50-Punkte-Grenze." : "Sie liegen unter der 50-Punkte-Grenze."} Noten nach IHK-Schlüssel: 92 bis 100 sehr gut, 81 bis 91 gut, 67 bis 80 befriedigend, 50 bis 66 ausreichend.`;
      ["score-box", "score-box2"].forEach(id => { const sb = $(id); sb.textContent = txt; sb.className = "score-box " + (s >= 50 ? "pass" : "fail"); });
      const st = loadState(); st[`mock_${m}`] = `${pts(s)}/${total}`; saveState(st);
    };
    a.querySelectorAll("input").forEach(i => i.addEventListener("change", upd)); upd();
    a.scrollIntoView({ behavior: "smooth" });
  };
  showScreen("work-screen");
}

// ---------- oral ----------
function startOral(o) {
  mode = "oral"; current = { item: o };
  $("work-title").textContent = `Fachgespräch ${o.id}`;
  $("work-badge").textContent = DOMAIN_LABELS[o.domain] || o.domain;
  timer.phase = 0;
  $("work-body").innerHTML = `<section class="panel"><h2>${esc(o.title)}</h2><p class="note">${esc(o.company)}</p>
    <p class="label">Betriebliche Ausgangssituation</p><p>${esc(o.situation)}</p>${exhibitsHtml(o.exhibits)}
    <p class="label">Handlungsauftrag</p><p><strong>${esc(o.assignment)}</strong></p>
    <p class="label">Notizen für die Vorbereitung</p><textarea rows="6"></textarea></section>`;
  function loadPhase(i) {
    const ph = ORAL_PHASES[i]; timer.phase = i;
    setupTimer(ph.seconds, ph.label, `Phase ${i + 1} von 3`);
    $("timer-start").onclick = () => runTimer(() => { if (i < 2) $("timer-next").classList.remove("hidden"); });
    $("timer-next").onclick = () => { if (i < 2) loadPhase(i + 1); };
    $("timer-next").textContent = "Weiter zur nächsten Phase";
  }
  loadPhase(0);
  $("reveal-warn").textContent = "Die Prüfung dauert höchstens 30 Minuten nach der Vorbereitung. Zeigen Sie die Lösung erst danach.";
  $("answer-section").style.display = "none";
  $("reveal-btn").onclick = () => {
    stopTimer();
    const a = $("answer-section"); a.style.display = "";
    const qs = o.examiner_questions.map((q, i) => `<div class="task"><h3>Prüferfrage ${i + 1}</h3><p><strong>${esc(q.question)}</strong></p><p class="label">Musterantwort</p><p>${esc(q.model_answer)}</p>
      <p class="label">Das sollte genannt werden</p><ul>${q.checklist.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("");
    const boxes = (arr, g) => arr.map((x, i) => `<label class="checkrow"><input type="checkbox" data-g="${g}"><span>${esc(x)}</span></label>`).join("");
    a.innerHTML = `<h2>Musterlösung und Selbstbewertung</h2><p class="label">Hinweise zur Vorbereitung</p><p>${esc(o.preparation_hints)}</p>
      <p class="label">Musterpräsentation</p>${o.presentation_outline.split("\n").map(l => `<p>${esc(l)}</p>`).join("")}
      <p class="label">Plan für Flipchart oder Pinnwand</p><p>${esc(o.flipchart_plan)}</p>
      <h3>Prüferfragen</h3>${qs}
      <h3>Bewertung der Präsentation (ein Drittel)</h3>${boxes(o.rating.presentation, "p")}
      <h3>Bewertung des Fachgesprächs (zwei Drittel)</h3>${boxes(o.rating.discussion, "d")}
      <div class="score-box" id="score-box"></div>
      <div class="label">Häufige Prüflingsfehler</div><p>${esc(o.common_errors)}</p><div class="label">Hinweise der Prüfer</div><p>${esc(o.examiner_notes)}</p>`;
    const upd = () => {
      const share = g => { const all = a.querySelectorAll(`input[data-g="${g}"]`); const on = a.querySelectorAll(`input[data-g="${g}"]:checked`); return all.length ? on.length / all.length : 0; };
      const p = share("p") * 100, d = share("d") * 100, total = d * 2 / 3 + p / 3;
      const sb = $("score-box");
      sb.textContent = `Präsentation ${Math.round(p)} Punkte, Fachgespräch ${Math.round(d)} Punkte, gewichtet ${Math.round(total)} von 100. ${total >= 50 ? "Sie liegen auf oder über der 50-Punkte-Grenze." : "Sie liegen unter der 50-Punkte-Grenze."} Das Raster ist das Übungsraster des Buches.`;
      sb.className = "score-box " + (total >= 50 ? "pass" : "fail");
      const st = loadState(); st[`oral_${o.id}`] = `${Math.round(total)}/100`; saveState(st);
    };
    a.querySelectorAll("input").forEach(i => i.addEventListener("change", upd)); upd();
    a.scrollIntoView({ behavior: "smooth" });
  };
  showScreen("work-screen");
}
