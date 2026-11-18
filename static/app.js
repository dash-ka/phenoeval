/* PhenoEval: local annotation app. The markup follows the design canvas (pages 4, 5 and 6). */
(function () {
'use strict';

var app = document.getElementById('app');
var S = null;           // state of the annotation page
var LIST = null;        // the annotator's assignments (for "Article N of M")
var termCache = {};     // hpo_id -> {label, def, syn, parents, systems, children}
var lineage = {}, lineageWaiting = {};

// ------------------------------------------------------------------ helpers
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function nowIso() { return new Date().toISOString(); }
function lab(id) { return id && termCache[id] ? termCache[id].label : (id || ''); }
function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
var SAVED_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5l2.5 2.5L11 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function setSaved(state) {
  var el = document.getElementById('saved'); if (!el) return;
  el.className = 'saved' + (state === 'busy' ? ' busy' : state === 'err' ? ' err' : '');
  el.innerHTML = state === 'busy' ? 'Saving…' : state === 'err' ? 'Not saved, retrying…' : SAVED_ICON + 'Saved';
}
function api(method, url, body) {
  var opts = { method: method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (method !== 'GET') setSaved('busy');
  return fetch(url, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401) { location.hash = '#/login'; throw new Error('not signed in'); }
      if (!r.ok) { if (method !== 'GET') setSaved('err'); throw new Error(j.error || ('error ' + r.status)); }
      if (method !== 'GET') setSaved('ok');
      return j;
    });
  });
}
function addTerms(t) { Object.keys(t || {}).forEach(function (k) { termCache[k] = Object.assign(termCache[k] || {}, t[k]); }); }
function getTerm(id) {
  if (termCache[id] && termCache[id].children) return Promise.resolve(termCache[id]);
  return api('GET', '/api/hpo/term/' + encodeURIComponent(id)).then(function (t) { termCache[id] = Object.assign(termCache[id] || {}, t); return t; });
}
var BRAND = '<div style="display:flex;align-items:center;gap:10px"><svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="7" fill="none" stroke="#2B3036" stroke-width="2"/><path d="M7 14l4 4 8-9" fill="none" stroke="#2B3036" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="font-weight:600;font-size:15px">PhenoEval</span></div>';
var BACK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" fill="none" stroke="#33383F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var IC = {
  accept: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9.5l3.2 3.2L14 5.5" fill="none" stroke="#5E8A2E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  confirm: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="5.6" fill="none" stroke="#2F7D5B" stroke-width="1.7"/><path d="M4.5 13.5l9-9" stroke="#2F7D5B" stroke-width="1.7" stroke-linecap="round"/></svg>',
  revise: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 14.5l1-3.6 7.6-7.6a1.4 1.4 0 012 2l-7.6 7.6z" fill="none" stroke="#8A5A0B" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  reject: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M5 5l8 8M13 5l-8 8" stroke="#A23B3B" stroke-width="2" stroke-linecap="round"/></svg>',
  remove: '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5" fill="none" stroke="#A23B3B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  person: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5" r="2.5" fill="none" stroke="#33383F" stroke-width="1.4"/><path d="M1.5 13c.6-2.4 2.3-3.8 4.5-3.8 1 0 1.9.3 2.6.8M10 9.5h5M13 7.5l2 2-2 2" fill="none" stroke="#33383F" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="#2B3036" stroke-width="1.7" stroke-linecap="round"/></svg>',
  arrow: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" fill="none" stroke="#1D5F66" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil: '<svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 14.5l1-3.6 7.6-7.6a1.4 1.4 0 012 2l-7.6 7.6z" fill="none" stroke="#74490A" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex:none"><circle cx="8" cy="8" r="6.6" fill="none" stroke="#A23B3B" stroke-width="1.4"/><path d="M8 7.2v4" stroke="#A23B3B" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="0.95" fill="#A23B3B"/></svg>',
  warn: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="#B07A1E" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.2v3.4" stroke="#B07A1E" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.6" r="0.85" fill="#B07A1E"/></svg>',
  book: '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2.8h3.6c.7 0 1.4.6 1.4 1.4v7.6c0-.6-.5-1.1-1.1-1.1H2zM12 2.8H8.4c-.7 0-1.4.6-1.4 1.4v7.6c0-.6.5-1.1 1.1-1.1H12z" fill="none" stroke="#A3A9B0" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  tag: '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.8 7.1V2.6c0-.5.4-.8.8-.8h4.5l5.1 5.1-5.3 5.3z" fill="none" stroke="#A3A9B0" stroke-width="1.2" stroke-linejoin="round"/><circle cx="4.6" cy="4.6" r="1" fill="#A3A9B0"/></svg>',
  vacant: '<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" style="flex:none"><path d="M5 20V9a3 3 0 013-3h12l15 14-15 14z" fill="#EEF1F4" stroke="#A3A9B0" stroke-width="1.6" stroke-dasharray="3.5 3" stroke-linejoin="round"/><circle cx="12.5" cy="13" r="2.4" fill="none" stroke="#A3A9B0" stroke-width="1.6"/></svg>',
  prev: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="#33383F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="#33383F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 5.5L7 9l3.5-3.5" fill="none" stroke="#33383F" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

// ------------------------------------------------------------------ router
function route() {
  var h = location.hash || '#/';
  if (h === '#/login') return renderLogin();
  // nobody reaches the articles before giving consent on the welcome page
  api('GET', '/api/me').then(function (me) {
    if (!me.consent_at || h === '#/welcome') return renderWelcome(me);
    var m;
    if ((m = h.match(/^#\/a\/(\w+)(?:\?m=(\w+))?/))) return openTask(m[1], m[2]);
    if ((m = h.match(/^#\/r\/(\w+)/))) return renderReview(m[1]);
    return renderDash();
  }).catch(function () {});
}

// ------------------------------------------------------------------ welcome and consent (as on the canvas)
function initials(name) {
  var w = String(name || '').replace(/^(dr|prof)\.?\s+/i, '').split(/[\s.]+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}
function renderWelcome(me) {
  S = null;
  var agreed = !!me.consent_at;
  var step = function (n, label, on) {
    return '<span style="display:inline-flex;align-items:center;gap:6px' + (on ? ';color:#1F2328;font-weight:600' : '') + '"><span style="width:22px;height:22px;border-radius:50%;' +
      (on ? 'background:#2B3036;color:#FFFFFF' : 'border:1px solid #C9C6BF;box-sizing:border-box') + ';display:inline-flex;align-items:center;justify-content:center;font-size:12px">' + n + '</span>' + label + '</span>';
  };
  var sep = '<span aria-hidden="true" style="width:32px;height:1px;background:#D5D2CB"></span>';
  var li = function (b, t) { return '<li><b style="font-weight:600">' + b + '</b> ' + t + '</li>'; };
  app.innerHTML = '<div style="min-height:100vh;display:flex;flex-direction:column;background:#F7F6F3">' +
    '<header style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 32px;flex-wrap:wrap;background:#FFFFFF;border-bottom:1px solid #E6E4DF">' + BRAND +
    '<div style="display:flex;align-items:center;gap:10px;font-size:14px"><span style="width:32px;height:32px;border-radius:50%;background:#EEF1F4;color:#2B3036;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:13px">' + esc(initials(me.name)) + '</span><span>' + esc(me.name) + '</span></div></header>' +
    '<main style="flex:1;padding:48px 20px 64px;display:flex;justify-content:center"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;gap:28px">' +
    '<nav aria-label="Onboarding steps" style="display:flex;gap:8px;align-items:center;font-size:13px;color:#5F6670;flex-wrap:wrap">' + step(1, 'About the study', true) + sep + step(2, 'Guidelines') + sep + step(3, 'Start annotating') + '</nav>' +
    '<div style="display:flex;flex-direction:column;gap:12px"><h1 style="margin:0;font-family:\'Source Serif 4\',Georgia,serif;font-weight:600;font-size:34px;line-height:1.2">Welcome, ' + esc(me.name) + '</h1>' +
    '<p style="margin:0;font-size:16px;line-height:1.65;color:#4A5059">Thank you for taking part in this study. We have collected patient-level phenotypic profiles from published case reports: for each patient described in an article, abnormal phenotypic features were identified in the text and described with Human Phenotype Ontology (HPO) terms. These profiles were created automatically, and we need clinical expertise to check how accurate they are.</p></div>' +
    '<section style="background:#FFFFFF;border:1px solid #E6E4DF;border-radius:12px;padding:24px 26px;display:flex;flex-direction:column;gap:16px"><h2 style="margin:0;font-size:17px;font-weight:600">What you will do</h2>' +
    '<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;font-size:15px;line-height:1.55;color:#33383F">' +
    li('Read the article.', 'The phenotypes identified for each patient are <span style="background:#D6ECEC;border-bottom:2px dashed #2E7F84;padding:0 2px;border-radius:3px">highlighted</span> in the text.') +
    li('Check the HPO term.', 'For each highlighted phenotype, decide whether its HPO term fits.') +
    li('Check the patient.', 'Verify whether the phenotype is assigned to the correct patient.') +
    li('Add what is missing.', 'If a patient\'s phenotype in the text was not highlighted, add it.') +
    li('Review and submit', 'your answers for the article.') + '</ol></section>' +
    '<section style="background:#FFFFFF;border:1px solid #E6E4DF;border-radius:12px;padding:24px 26px;display:flex;flex-direction:column;gap:14px"><h2 style="margin:0;font-size:17px;font-weight:600">Data and consent</h2>' +
    '<p style="margin:0;font-size:14px;line-height:1.6;color:#4A5059">We store your decisions, optional comments, timestamps and time spent per item, linked to a pseudonymous annotator ID. Your name and email are used only to manage access and are never published. Participation is voluntary and you can withdraw at any time. Before you agree, please read the <a href="/information-sheet" target="_blank" rel="noopener" style="color:#1F2328;font-weight:500;text-decoration:underline;text-underline-offset:2px">full information sheet</a> (opens in a new tab).</p>' +
    '<label style="display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.5;cursor:pointer;padding:12px 14px;border-radius:10px;background:#F7F6F3">' +
    '<input id="agree" type="checkbox"' + (agreed ? ' checked disabled' : '') + ' style="width:20px;height:20px;margin:1px 0 0;accent-color:#2B3036;flex:none">' +
    '<span>I have read the information sheet and agree to take part in this evaluation.</span></label></section>' +
    '<div id="werr" style="color:#A23B3B;font-size:13px;text-align:right"></div>' +
    '<div style="display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap"><button type="button" id="wgo" class="btn-dark' + (agreed ? '' : ' off') + '" style="height:46px;padding:0 22px;font-size:15px;gap:8px">Continue to guidelines' +
    '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
    '</div></main></div>';
  var box = document.getElementById('agree'), go = document.getElementById('wgo');
  box.onchange = function () { go.classList.toggle('off', !box.checked); };
  go.onclick = function () {
    if (!box.checked) return;
    (agreed ? Promise.resolve() : api('POST', '/api/consent', {})).then(function () { location.href = '/guidelines.html'; })
      .catch(function (er) { document.getElementById('werr').textContent = er.message; });
  };
}
window.addEventListener('hashchange', route);
function loadList() { return api('GET', '/api/articles').then(function (r) { LIST = r; return r; }); }
function posText(pmid) {
  if (!LIST) return '';
  var i = LIST.findIndex(function (x) { return x.pmid === pmid; });
  return i < 0 ? '' : 'Article <b style="font-weight:600;color:#1F2328">' + (i + 1) + '</b> of ' + LIST.length;
}

// ------------------------------------------------------------------ sign in
function renderLogin() {
  S = null;
  app.innerHTML = '<header style="display:flex;align-items:center;padding:14px 32px;background:#FFF;border-bottom:1px solid #E6E4DF">' + BRAND + '</header>' +
    '<main style="display:flex;justify-content:center;padding:80px 20px"><form id="lf" class="signin" style="width:100%;max-width:420px;background:#FFF;border:1px solid #E6E4DF;border-radius:14px;padding:28px;display:flex;flex-direction:column;gap:14px">' +
    '<h1 style="margin:0;font-family:\'Source Serif 4\',Georgia,serif;font-weight:600;font-size:28px">Sign in</h1>' +
    '<p style="margin:0;font-size:14px;color:#4A5059">Local test version. Your answers are saved under your email.</p>' +
    '<label style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600">Name<input class="field" name="name" required placeholder="Dr. M. Rossi"></label>' +
    '<label style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600">Email<input class="field" name="email" type="email" required placeholder="m.rossi@hospital.org"></label>' +
    '<div id="lerr" style="color:#A23B3B;font-size:13px"></div><button class="btn-dark" type="submit" style="justify-content:center;height:44px">Continue</button></form></main>';
  document.getElementById('lf').onsubmit = function (e) {
    e.preventDefault();
    api('POST', '/api/login', { name: e.target.name.value, email: e.target.email.value })
      .then(function () { if (location.hash === '#/') route(); else location.hash = '#/'; })
      .catch(function (er) { document.getElementById('lerr').textContent = er.message; });
  };
}

// ------------------------------------------------------------------ page 4: my assignments
var DASH = { filter: 'all', q: '' };
function renderDash() {
  S = null;
  Promise.all([api('GET', '/api/me'), loadList()]).then(function (r) { drawDash(r[0], r[1]); }).catch(function () {});
}
function drawDash(me, data) {
  var stOf = function (d) { return d.submitted_at ? 'done' : d.done === 0 ? 'todo' : 'prog'; };
  var count = function (k) { return data.filter(function (d) { return k === 'all' || stOf(d) === k; }).length; };
  var doneN = data.reduce(function (s, d) { return s + d.done; }, 0), totalN = data.reduce(function (s, d) { return s + d.total; }, 0);
  var pct = totalN ? Math.round(100 * doneN / totalN) : 0;
  var q = DASH.q.trim().toLowerCase();
  var rows = data.filter(function (d) { return (DASH.filter === 'all' || stOf(d) === DASH.filter) && (!q || d.title.toLowerCase().indexOf(q) >= 0 || d.pmid.indexOf(q) >= 0); });
  var next = data.find(function (d) { return !d.submitted_at; });
  var initials = me.name.split(/\s+/).filter(function (w) { return /^[A-Za-z]/.test(w) && !/^dr\.?$/i.test(w); }).map(function (w) { return w[0].toUpperCase(); }).slice(0, 2).join('');
  var h = '<header style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 32px;flex-wrap:wrap;background:#FFF;border-bottom:1px solid #E6E4DF">' +
    '<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap">' + BRAND +
    '<nav style="display:flex;gap:4px;font-size:14px"><a href="#/" style="padding:8px 12px;border-radius:8px;color:#1F2328;background:#F0EEE9;text-decoration:none;font-weight:500">My assignments</a><a href="/guidelines.html" style="padding:8px 12px;border-radius:8px;color:#4A5059;text-decoration:none">Guidelines</a></nav></div>' +
    '<div style="display:flex;align-items:center;gap:14px;font-size:14px"><span style="width:32px;height:32px;border-radius:50%;background:#EEF1F4;color:#2B3036;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:13px">' + esc(initials) + '</span><span>' + esc(me.name) + '</span><a href="#/login" id="lo" style="font-size:13px;color:#5F6670">Sign out</a></div></header>';
  h += '<main style="padding:36px 32px 64px;display:flex;justify-content:center"><div style="width:100%;max-width:1180px;display:flex;flex-direction:column;gap:28px">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap"><div style="display:flex;flex-direction:column;gap:6px"><h1 style="margin:0;font-family:\'Source Serif 4\',Georgia,serif;font-weight:600;font-size:30px">My assignments</h1>' +
    '<p style="margin:0;font-size:15px;color:#4A5059">Pick up where you left off. Articles stay editable until the study closes.</p></div>' +
    (next ? '<a class="btn-dark" href="#/a/' + next.pmid + '" style="height:44px;padding:0 20px;font-size:15px">Resume next article <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>' : '') + '</div>' +
    '<section style="background:#FFF;border:1px solid #E6E4DF;border-radius:12px;padding:18px 22px;display:flex;flex-direction:column;gap:12px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">' +
    '<span style="display:inline-flex;align-items:baseline;gap:10px;font-size:14px;color:#4A5059"><b style="font-size:24px;font-weight:600;color:#1F2328">' + pct + '%</b><span>Overall progress</span></span>' +
    '<span style="font-size:14px;color:#4A5059">' + doneN + ' of ' + totalN + ' phenotype mentions reviewed · ' + count('done') + ' of ' + data.length + ' articles submitted</span></div>' +
    '<div role="progressbar" style="height:8px;border-radius:999px;background:#EEECE7;overflow:hidden;display:flex"><span class="ov" style="width:' + pct + '%"></span></div></section>' +
    '<section style="background:#FFF;border:1px solid #E6E4DF;border-radius:12px;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #E6E4DF;flex-wrap:wrap">' +
    '<div role="group" style="display:inline-flex;gap:2px;padding:3px;background:#F0EEE9;border-radius:10px">' +
    [['all', 'All'], ['todo', 'Not started'], ['prog', 'In progress'], ['done', 'Submitted']].map(function (f) { return '<button type="button" class="dseg' + (DASH.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + ' ' + count(f[0]) + '</button>'; }).join('') + '</div>' +
    '<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:#5F6670"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="#5F6670" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="#5F6670" stroke-width="1.5" stroke-linecap="round"/></svg>' +
    '<input id="dq" type="search" value="' + esc(DASH.q) + '" placeholder="Search title or PMID" style="height:36px;width:240px;max-width:100%;padding:0 10px;border:1px solid #D5D2CB;border-radius:8px;font:inherit;font-size:14px"></label></div>' +
    '<div style="overflow-x:auto"><table style="width:100%;min-width:860px;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#5F6670;font-size:12.5px"><th style="padding:10px 18px;font-weight:500">Article</th><th style="padding:10px 12px;font-weight:500;width:90px">Patients</th><th style="padding:10px 12px;font-weight:500;width:240px">Progress</th><th style="padding:10px 18px;font-weight:500;width:120px"></th></tr></thead><tbody>' +
    rows.map(function (d) {
      var st = stOf(d), p = d.total ? Math.round(100 * d.done / d.total) : 0;
      var progText = st === 'done' ? 'Submitted' : st === 'todo' ? 'Not started' : d.done + ' / ' + d.total;
      var act = st === 'done' ? ['Review', '#/r/' + d.pmid, 'act ghost'] : d.done === d.total ? ['Review', '#/r/' + d.pmid, 'act primary'] : [st === 'todo' ? 'Start' : 'Continue', '#/a/' + d.pmid, 'act primary'];
      return '<tr class="row" style="border-top:1px solid #EEECE7"><td style="padding:14px 18px"><div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:\'Source Serif 4\',Georgia,serif;font-weight:600;font-size:16px;line-height:1.35;color:#1F2328">' + esc(d.title) + '</span><span style="font-size:12.5px;color:#5F6670">PMID ' + d.pmid + (d.journal ? ' · ' + esc(d.journal) : '') + (d.year ? ' · ' + d.year : '') + '</span></div></td>' +
        '<td style="padding:14px 12px;color:#4A5059">' + d.patients + '</td><td style="padding:14px 12px"><div style="display:flex;align-items:center;gap:10px"><span style="flex:1;height:6px;border-radius:999px;background:#EEECE7;overflow:hidden;display:flex"><span class="bar-' + st + '" style="width:' + p + '%"></span></span><span class="prog ' + st + '">' + progText + '</span></div></td>' +
        '<td style="padding:14px 18px;text-align:right"><a href="' + act[1] + '" class="' + act[2] + '">' + act[0] + '</a></td></tr>';
    }).join('') + '</tbody></table></div></section></div></main>';
  app.innerHTML = h;
  document.getElementById('lo').onclick = function () { api('POST', '/api/logout', {}).catch(function () {}); };
  app.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { DASH.filter = b.dataset.f; drawDash(me, data); }; });
  var dq = document.getElementById('dq');
  dq.oninput = function () { DASH.q = dq.value; drawDash(me, data); var n = document.getElementById('dq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
}

// ------------------------------------------------------------------ page 5: annotation
var ST = { pending: 'st-pending', accept: 'st-accept', revise: 'st-change', no_code: 'st-nofit', reject: 'st-notphen', added: 'st-added' };
var BADGE = { pending: 'b-pending', accept: 'b-accept', revise: 'b-change', no_code: 'b-nofit', reject: 'b-notphen', added: 'b-added' };
var TDOT = { pending: 't-pending', accept: 't-accept', revise: 't-revise', no_code: 't-ghost', reject: 't-reject', added: 't-added' };
var LABEL = { pending: 'To review', accept: 'Accepted', revise: 'Revised', no_code: 'No code', reject: 'Rejected', added: 'Added' };
var LEGEND = [
  ['pending', 'To review', 'fl-pending', 'lt-pending', 'Phenotype mentions you have not decided on yet.'],
  ['accept', 'Accepted', 'fl-accept', 'lt-accept', 'You accepted the predicted HPO term: it fits the phenotype mention.'],
  ['revise', 'Revised', 'fl-revise', 'lt-revise', 'You replaced the predicted term with a better-fitting HPO term.'],
  ['reject', 'Rejected', 'fl-reject', 'lt-reject', 'Not an observed phenotypic abnormality of a patient from this study (e.g. a normal, absent or unconfirmed finding; not a phenotypic abnormality; or a general phenotype not associated with any patient of this study).'],
  ['added', 'Added', 'fl-added', 'lt-added', 'Phenotype mentions you added because they were missing from the profile.'],
  ['no_code', 'No code', 'fl-ungrounded', 'lt-ungrounded', 'No HPO term fits the phenotype mention (an ontology gap).']
];
// A term can fall under several organ systems; the profile shows it under the first one in this order (as in the design).
var SYS_PRIORITY = ['HP:0000478', 'HP:0000598', 'HP:0000152', 'HP:0001626', 'HP:0002086', 'HP:0000707', 'HP:0033127', 'HP:0040064', 'HP:0025031', 'HP:0000119', 'HP:0000818', 'HP:0001574', 'HP:0000769', 'HP:0045027', 'HP:0001608', 'HP:0001871', 'HP:0002715', 'HP:0001939', 'HP:0002664', 'HP:0001197', 'HP:0001507', 'HP:0025354', 'HP:0025142'];

function openTask(pmid, selId) {
  if (S && S.pmid === pmid) { if (selId && S.byId[selId]) select(selId, false); return; }
  Promise.all([api('GET', '/api/articles/' + pmid), LIST ? Promise.resolve(LIST) : loadList()]).then(function (r) {
    var art = r[0];
    addTerms(art.terms);
    S = { pmid: pmid, art: art, pt: art.patients.length ? art.patients[0].id : null, sel: null, selAdd: null, allPts: false, hide: {},
      rev: null, q: '', res: null, re: null, add: null, edit: null, lastLoc: null, view: 'list', maxRes: 'all', pages: 1,
      ptMenu: false, ptQ: '', lgQuiet: null, lastCounts: {} };
    S.byId = {}; art.mentions.forEach(function (m, i) { m.i = i; S.byId[m.id] = m; });
    S.ptById = {}; S.ptByLabel = {}; art.patients.forEach(function (p) { S.ptById[p.id] = p; S.ptByLabel[p.label] = p; });
    app.innerHTML = '<header style="height:60px;box-sizing:border-box;display:flex;align-items:center;gap:18px;padding:0 20px;background:#FFFFFF;border-bottom:1px solid #E6E4DF;flex-wrap:wrap">' +
      '<a href="#/" style="display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#33383F;text-decoration:none;padding:8px 10px;border-radius:8px">' + BACK + 'My assignments</a>' +
      '<span aria-hidden="true" style="width:1px;height:24px;background:#E6E4DF"></span><span style="font-size:14px;color:#4A5059">' + posText(pmid) + '</span>' +
      '<div style="display:flex;align-items:center;gap:10px;min-width:200px"><span role="progressbar" style="width:140px;height:6px;border-radius:999px;background:#EEECE7;overflow:hidden;display:flex"><span class="pbar" id="pbar"></span></span><span id="ptext" style="font-size:13px;color:#4A5059;font-variant-numeric:tabular-nums"></span></div>' +
      '<span style="flex:1"></span><span class="saved" id="saved">' + SAVED_ICON + 'Saved</span>' +
      '<a href="/guidelines.html" target="_blank" rel="noopener" style="font-size:14px;color:#33383F;text-decoration:none;padding:8px 10px;border-radius:8px">Guidelines</a>' +
      '<a class="btn-dark" id="subbtn" href="#/r/' + pmid + '"></a></header>' +
      '<div class="panes"><main class="pane-l" id="left"></main>' +
      '<div class="pane-split" id="split" role="separator" aria-orientation="vertical" aria-label="Drag to resize the right panel; double-click to reset" tabindex="0" title="Drag to resize · double-click to reset"><span></span></div>' +
      '<aside class="pane-r" id="right"></aside></div>';
    var L = document.getElementById('left'), R = document.getElementById('right');
    paneSplit(document.getElementById('split'), R);
    L.addEventListener('click', onLeftClick);
    L.addEventListener('mouseover', function (e) { var w = e.target.closest('.lgw'); if (!w && S && S.lgQuiet) { S.lgQuiet = null; document.querySelectorAll('.lgw-quiet').forEach(function (x) { x.classList.remove('lgw-quiet'); }); } });
    L.addEventListener('mouseup', function () { setTimeout(takeSelection, 0); });
    L.addEventListener('keyup', function (e) { if (e.shiftKey) takeSelection(); });
    R.addEventListener('click', onRightClick);
    // drum: mouse wheel / trackpad rolls one patient at a time; a vertical swipe does the same on touch screens
    var wheelAcc = 0, wheelAt = 0;
    R.addEventListener('wheel', function (e) {
      if (!e.target.closest('.drum')) return;
      e.preventDefault();
      var now = Date.now(); if (now - wheelAt > 260) wheelAcc = 0;
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) >= 30 && now - wheelAt > 180) { wheelAt = now; var d = wheelAcc > 0 ? 1 : -1; wheelAcc = 0; drumGo(d); }
    }, { passive: false });
    var swipeY = null;
    R.addEventListener('pointerdown', function (e) { swipeY = e.target.closest('.drum') ? e.clientY : null; });
    R.addEventListener('pointerup', function (e) {
      if (swipeY == null) return; var dy = e.clientY - swipeY; swipeY = null;
      if (Math.abs(dy) > 18) { S.drumSwiped = Date.now(); drumGo(dy < 0 ? 1 : -1); }
    });
    R.addEventListener('input', onRightInput);
    R.addEventListener('change', onRightChange);
    var first = selId && S.byId[selId] ? selId : null;
    if (first) S.pt = effPt(S.byId[first]) || S.byId[first].pt;
    renderAll();
    if (first) select(first, false);
  }).catch(function (e) { if (e.message !== 'not signed in') toast(e.message); });
}

function dec(m) { return S.art.decisions[m.id] || null; }
function status(m) { var d = dec(m); return d && d.decision ? d.decision : 'pending'; }
function effPt(m) { var d = dec(m); if (d && d.reassigned_to) { var p = S.ptByLabel[d.reassigned_to]; return p ? p.id : null; } return m.pt; }
function belongs(m, pt) { var e = effPt(m); return e === pt || (e === null && m.pt === pt); }
function shown(m) { return S.allPts || belongs(m, S.pt); }
function minePt(pt) { return S.art.mentions.filter(function (m) { return belongs(m, pt); }); }
function nz(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function differs(m) { return !!m.x && nz(m.x) !== nz(m.text); }
function sysName(label) { return String(label || 'Other').replace(/^Abnormality of (the )?/, '').replace(/^./, function (c) { return c.toUpperCase(); }); }
function primarySystem(t) {
  var ss = (t && t.systems) || [];
  if (!ss.length) return 'Other';
  var rank = function (x) { var i = SYS_PRIORITY.indexOf(x.id); return i < 0 ? 99 : i; };
  return sysName(ss.slice().sort(function (a, b) { return rank(a) - rank(b); })[0].label);
}

function renderAll() { renderLeft(); renderRight(); renderTop(); }
function renderTop() {
  var tot = S.art.mentions.length, done = S.art.mentions.filter(function (m) { return status(m) !== 'pending'; }).length;
  var b = document.getElementById('subbtn'); if (b) b.textContent = done < tot ? 'Review & submit · ' + (tot - done) + ' left' : 'Review & submit';
  var pb = document.getElementById('pbar'); if (pb) pb.style.width = (tot ? Math.round(100 * done / tot) : 0) + '%';
  var pt = document.getElementById('ptext'); if (pt) pt.textContent = done + ' / ' + tot + ' reviewed';
}

// ---- article text (left pane)
function renderLeft() {
  var a = S.art, el = document.getElementById('left'), sc = el.scrollTop;
  var sideways = Array.prototype.map.call(el.querySelectorAll('.tbl-wrap'), function (w) { return w.scrollLeft; }); // keep wide tables where they were
  var counts = { pending: 0, accept: 0, revise: 0, reject: 0, added: 0, no_code: 0 };
  a.mentions.forEach(function (m) { if (shown(m)) counts[status(m)]++; });
  a.added.forEach(function (x) { if (S.allPts || x.patient_id === S.pt) counts.added++; });
  var legend = LEGEND.map(function (c, ci) {
    var off = !!S.hide[c[0]], n = counts[c[0]], digits = String(n).padStart(2, '0').split(''), prev = String(S.lastCounts[c[0]] == null ? n : S.lastCounts[c[0]]).padStart(2, '0');
    return '<span class="lgw' + (S.lgQuiet === c[0] ? ' lgw-quiet' : '') + '"><button type="button" class="hl ' + ST[c[0]] + ' lg lgbtn' + (off ? ' lg-off' : '') + '" data-lg="' + c[0] + '" aria-pressed="' + !off + '">' + c[1] + '</button>' +
      '<span class="flip ' + c[2] + '" aria-label="' + n + ' mentions">' + digits.map(function (d, i) { return '<span class="fd' + (prev.padStart(digits.length, '0')[i] !== d ? ' anim' : '') + '">' + d + '</span>'; }).join('') + '</span>' +
      '<span class="lgtip ' + c[3] + (ci >= 4 ? ' lgtip-r' : '') + '" role="tooltip"><b>' + c[1] + '</b><span>' + c[4] + '</span><i>' + (off ? 'Hidden · click to show these highlights' : 'Click to hide these highlights') + '</i></span></span>';
  }).join('');
  S.lastCounts = counts;
  var h = '<div style="max-width:760px;margin:0 auto;padding:32px 40px 80px;display:flex;flex-direction:column;gap:22px">' +
    '<div style="display:flex;flex-direction:column;gap:8px"><h1 style="margin:0;font-family:\'Source Serif 4\',Georgia,serif;font-weight:600;font-size:26px;line-height:1.3">' + esc(a.article.title) + '</h1>' +
    '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:#5F6670;align-items:center"><span class="mono">PMID ' + a.article.pmid + '</span>' + (a.article.journal ? '<span>' + esc(a.article.journal) + (a.article.year ? ' · ' + a.article.year : '') + '</span>' : '') +
    '<a href="https://pubmed.ncbi.nlm.nih.gov/' + a.article.pmid + '/" target="_blank" rel="noopener">Open on PubMed</a></div></div>' +
    '<div class="lgbar">' +
    '<div role="group" aria-label="Highlights shown" style="display:inline-flex;gap:2px;padding:3px;background:#F0EEE9;border-radius:9px"><button type="button" class="seg' + (S.allPts ? '' : ' on') + '" data-all="0">This patient</button><button type="button" class="seg' + (S.allPts ? ' on' : '') + '" data-all="1">All patients</button></div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12.5px;color:#4A5059">' + legend + '</div></div>';
  a.sections.forEach(function (s) {
    h += '<section style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#5F6670">' + esc(s.kind.replace('_', ' ')) + '</span><h2 style="margin:0;font-size:16px;font-weight:600">' + esc(s.title || '') + '</h2></div>';
    h += s.rows ? tableHtml(s) : '<p data-sec="' + esc(s.id) + '" style="margin:0;font-family:\'Source Serif 4\',Georgia,serif;font-size:17px;line-height:1.75;color:#24282E;white-space:pre-wrap">' + proseHtml(s) + '</p>';
    h += '</section>';
  });
  el.innerHTML = h + '</div>';
  el.scrollTop = sc;
  el.querySelectorAll('.tbl-wrap').forEach(function (w, i) { if (sideways[i]) w.scrollLeft = sideways[i]; });
  stickLegend();
}
// legend bar sticks to the top of the article pane; a soft shadow appears once it is stuck
function stickLegend() {
  var pane = document.getElementById('left'), bar = pane && pane.querySelector('.lgbar');
  if (!bar) return;
  bar.classList.toggle('stuck', pane.scrollTop > 0 && bar.getBoundingClientRect().top - pane.getBoundingClientRect().top <= 0.5);
  if (!pane._lgOn) { pane._lgOn = 1; pane.addEventListener('scroll', stickLegend, { passive: true }); }
}
function vis(it) {
  if (it.m) return shown(it.m) && !S.hide[status(it.m)] ? 1 : 0;
  return (S.allPts || it.x.patient_id === S.pt) && !S.hide.added ? 1 : 0;
}
function itemClass(it, isEnd) {
  var st = it.m ? status(it.m) : 'added', sel = it.m ? S.sel === it.m.id : S.selAdd === it.x.added_id;
  return 'hl ' + (vis(it) ? ST[st] : ST[st] + ' off') + (isEnd ? ' end' : '') + (sel ? ' sel' : '');
}
function itemTip(it) {
  if (it.x) return 'Added by you · ' + lab(it.x.hpo_id);
  var m = it.m, d = dec(m);
  return (m.t ? lab(m.t) : 'No HPO term predicted') + ' · ' + LABEL[status(m)] + (d && d.reassigned_to ? ' · reassigned to ' + d.reassigned_to : '');
}
function proseHtml(s) {
  var text = s.text || '', items = [];
  S.art.mentions.forEach(function (m) { if (m.sec === s.id && m.start != null) items.push({ a: m.start, b: m.end, m: m }); });
  // an added phenotype is highlighted where it was found in the text (the server records the place)
  S.art.added.forEach(function (x) { if (x.section_id === s.id && x.cell_row == null && x.start_offset != null) items.push({ a: x.start_offset, b: x.end_offset, x: x }); });
  return segHtml(text, items);
}
// Highlights one text (a prose section or one table cell): each mention marks only its own words.
function segHtml(text, items) {
  if (!items.length) return esc(text);
  var cuts = [0, text.length];
  items.forEach(function (it) { cuts.push(it.a, it.b); });
  cuts = cuts.filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort(function (p, q) { return p - q; });
  var out = '';
  for (var k = 0; k < cuts.length - 1; k++) {
    var a = cuts[k], b = cuts[k + 1];
    if (a === b) continue;
    var piece = esc(text.slice(a, b));
    var cov = items.filter(function (it) { return it.a <= a && it.b >= b; });
    if (!cov.length) { out += piece; continue; }
    cov.sort(function (p, q) { return (vis(q) - vis(p)) || ((p.b - p.a) - (q.b - q.a)); });
    var it = cov[0];
    out += '<a href="#" class="' + itemClass(it, b === it.b) + '" ' + (it.m ? 'data-m="' + it.m.id + '"' : 'data-x="' + it.x.added_id + '"') + ' title="' + esc(itemTip(it)) + '">' + piece + '</a>';
  }
  return out;
}
function tableHtml(s) {
  var byCell = {}, addCell = {};
  S.art.mentions.forEach(function (m) { if (m.sec === s.id && m.cell) (byCell[m.cell[0] + ',' + m.cell[1]] = byCell[m.cell[0] + ',' + m.cell[1]] || []).push(m); });
  S.art.added.forEach(function (x) { if (x.section_id === s.id && x.cell_row != null && x.start_offset != null) (addCell[x.cell_row + ',' + x.cell_col] = addCell[x.cell_row + ',' + x.cell_col] || []).push(x); });
  var hdr = s.header_rows || 1, h = s.caption ? '<div class="caption">' + esc(s.caption) + '</div>' : '';
  h += '<div class="tbl-wrap"><table class="art">';
  s.rows.forEach(function (row, i) {
    h += '<tr>' + row.map(function (c, j) {
      var tag = i < hdr ? 'th' : 'td', ms = byCell[i + ',' + j] || [], xs = addCell[i + ',' + j] || [];
      var open = '<' + tag + ' data-sec="' + esc(s.id) + '" data-cell="' + i + ',' + j + '">';
      if (!ms.length && !xs.length) return open + esc(c) + '</' + tag + '>';
      var its = ms.map(function (m) { return { a: m.cell[2] != null ? m.cell[2] : 0, b: m.cell[3] != null ? m.cell[3] : c.length, m: m }; })
        .concat(xs.map(function (x) { return { a: x.start_offset, b: x.end_offset, x: x }; }));
      return open + segHtml(c, its) + '</' + tag + '>';
    }).join('') + '</tr>';
  });
  return h + '</table></div>';
}
// The evidence of an added phenotype comes only from a selection in the article: one paragraph or one table cell.
// Its place is measured as character offsets in the section text (or in the cell text), so it is exact even
// when the same words appear elsewhere.
function selectionPlace() {
  var sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  var r = sel.getRangeAt(0);
  var box = function (n) { n = n.nodeType === 1 ? n : n.parentNode; return n && n.closest ? n.closest('#left [data-sec]') : null; };
  var b0 = box(r.startContainer), b1 = box(r.endContainer);
  if (!b0 && !b1) return null;
  if (!b0 || b0 !== b1) return { error: 'Select words within one paragraph or one table cell.' };
  var pre = document.createRange(); pre.selectNodeContents(b0); pre.setEnd(r.startContainer, r.startOffset);
  var a = pre.toString().length, txt = r.toString(), b = a + txt.length;
  var lead = txt.length - txt.replace(/^\s+/, '').length, trail = txt.length - txt.replace(/\s+$/, '').length;
  a += lead; b -= trail;
  if (b <= a) return null;
  var cell = b0.dataset.cell ? b0.dataset.cell.split(',').map(Number) : null;
  return { sec: b0.dataset.sec, cell: cell, start: a, end: b, text: b0.textContent.slice(a, b) };
}
// remember the latest selection in the article; it becomes the evidence only when "Use selection" is pressed
function takeSelection() {
  if (!S) return;
  var p = selectionPlace();
  if (!p) return;
  S.lastLoc = p.error ? null : p;
  S.lastSelErr = p.error || '';
}
function useSelection(f) {
  var p = selectionPlace();                 // the selection still on screen, if any
  if (p) { S.lastLoc = p.error ? null : p; S.lastSelErr = p.error || ''; }
  if (S.lastLoc) { f.loc = S.lastLoc; f.span = S.lastLoc.text; f.selErr = ''; }
  else f.selErr = S.lastSelErr || 'First select the words in the article text, then press Use selection.';
  renderRight();
}
function onLeftClick(e) {
  var t = e.target.closest('[data-m],[data-x],[data-lg],[data-all]');
  if (!t) return;
  if (t.tagName === 'A') e.preventDefault();
  if (t.dataset.lg) { S.hide[t.dataset.lg] = !S.hide[t.dataset.lg]; S.lgQuiet = t.dataset.lg; renderLeft(); return; }
  if (t.dataset.all) { S.allPts = t.dataset.all === '1'; renderAll(); return; }
  if (window.getSelection && String(window.getSelection()).length > 2) return; // selecting text for 'Add', not clicking
  if (t.dataset.m) { select(t.dataset.m, true); return; }
  if (t.dataset.x) openAdded(+t.dataset.x, false);
}
function select(id, fromText) {
  var m = S.byId[id];
  var samePt = (effPt(m) || m.pt) === S.pt;
  S.sel = id; S.selAdd = null; S.edit = null; S.rev = null; S.re = null; S.q = ''; S.res = null; S.ptMenu = false;
  S.pt = effPt(m) || m.pt;
  if (samePt) { markSelected(); renderRight(); renderTop(); } else renderAll();
  api('POST', '/api/articles/' + S.pmid + '/event', { action: 'open', mention_id: id, client_at: nowIso() }).catch(function () {});
  if (fromText) document.getElementById('right').scrollTop = 0;
  centerInText('[data-m="' + id + '"]');
  var d = dec(m), ref = m.t || (d && d.final_hpo_id);
  if (ref) getTerm(ref).then(function () { if (S && S.sel === id) renderRight(); }).catch(function () {});
}
function openAdded(xid, scroll) {
  var x = S.art.added.find(function (a) { return a.added_id === xid; }); if (!x) return;
  S.pt = x.patient_id; S.sel = null; S.selAdd = xid; S.rev = null; S.re = null; S.edit = null; S.add = null;
  renderAll();
  getTerm(x.hpo_id).then(function () { if (S && S.selAdd === xid) renderRight(); }).catch(function () {});
  centerInText('[data-x="' + xid + '"]');
}
// When a card opens, its evidence glides to the middle of the article pane (and sideways inside wide tables).
// A gentle ease-in-out whose duration grows with the distance, instead of the browser's quick jump.
var glideRun = 0;
function centerInText(sel) {
  requestAnimationFrame(function () {
    var el = document.querySelector('#left ' + sel), pane = document.getElementById('left');
    if (!el || !pane) return;
    var moves = [];
    var wrap = el.closest('.tbl-wrap');
    if (wrap) {
      var w = wrap.getBoundingClientRect(), r0 = el.getBoundingClientRect();
      var maxX = wrap.scrollWidth - wrap.clientWidth;
      var tx = Math.max(0, Math.min(maxX, wrap.scrollLeft + (r0.left + r0.width / 2) - (w.left + w.width / 2)));
      moves.push({ node: wrap, prop: 'scrollLeft', from: wrap.scrollLeft, to: tx });
    }
    var p = pane.getBoundingClientRect(), r = el.getBoundingClientRect();
    var maxY = pane.scrollHeight - pane.clientHeight;
    var bar = pane.querySelector('.lgbar'), bh = bar ? bar.offsetHeight : 0;
    var ty = Math.max(0, Math.min(maxY, pane.scrollTop + (r.top + r.height / 2) - (p.top + bh + (p.height - bh) / 2)));
    moves.push({ node: pane, prop: 'scrollTop', from: pane.scrollTop, to: ty });
    var dist = Math.max.apply(null, moves.map(function (m) { return Math.abs(m.to - m.from); }));
    if (dist < 2) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dur = reduce ? 0 : Math.min(900, 380 + dist * 0.25), t0 = performance.now(), run = ++glideRun;
    var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
    (function frame(now) {
      if (run !== glideRun) return; // a newer glide took over
      var t = dur ? Math.min(1, (now - t0) / dur) : 1, k = ease(t);
      moves.forEach(function (m) { m.node[m.prop] = m.from + (m.to - m.from) * k; });
      if (t < 1) requestAnimationFrame(frame);
    })(t0);
  });
}
// Moving between mentions of the same patient only changes which highlight is framed: no need to rebuild the text.
function markSelected() {
  document.querySelectorAll('#left .hl.sel').forEach(function (x) { x.classList.remove('sel'); });
  if (S.sel) document.querySelectorAll('#left [data-m="' + S.sel + '"]').forEach(function (x) { x.classList.add('sel'); });
  if (S.selAdd) document.querySelectorAll('#left [data-x="' + S.selAdd + '"]').forEach(function (x) { x.classList.add('sel'); });
}

// ---- patient display helpers
function ptAbbr(label) {
  var t = String(label || '').trim(), toks = t.split(/[\s,;:()]+/).filter(Boolean);
  var num = toks.filter(function (x) { return /\d/.test(x); }).pop();
  if (num && num.length <= 5) return num.replace(/^(patient|case|pt|p)\.?#?/i, '') || num;
  if (toks.length >= 2) return (toks[0][0] + toks[1][0]).toUpperCase();
  return (t[0] || '?').toUpperCase();
}
function ptAvatar(p, st, size) {
  var col = st.done ? '#6E9A3F' : '#5F9093', big = String(st.d).length + String(st.n).length > 3, fs = size * (big ? .34 : .4),
    ab = '<i class="fr">' + (st.n ? '<b>' + st.d + '/' + st.n + '</b>' : '<small>–</small>') + '</i>';
  return '<span class="ptav' + (st.done ? ' done' : '') + '" style="width:' + size + 'px;height:' + size + 'px;background:conic-gradient(' + col + ' ' + st.pct + '%,#E6E4DF 0)" aria-hidden="true"><span style="font-size:' + fs.toFixed(1) + 'px">' + (st.done ? '<svg width="' + Math.round(size * .42) + '" height="' + Math.round(size * .42) + '" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ab) + '</span></span>';
}
function ptBar(st) {
  return '<span class="ptbarline"><span class="' + (st.done ? 'done' : '') + '" style="width:' + st.pct + '%"></span></span>';
}
function ptBadge(st) {
  if (!st.n) return '<span class="ptbadge none">No predictions</span>';
  if (st.done) return '<span class="ptbadge ok">All reviewed</span>';
  return '';
}

// ---- resizable right panel: drag the divider (or focus it and use the arrow keys); the width is remembered in this browser
var PANE_DEFAULT = 500;
function paneWidthClamp(w) { return Math.round(Math.max(380, Math.min(w, Math.min(1000, window.innerWidth - 460)))); }
function paneSet(R, w, keep) {
  w = paneWidthClamp(w);
  R.style.flexBasis = w + 'px';
  if (keep) { try { localStorage.setItem('pe_right_w', String(w)); } catch (e) {} }
}
function paneSplit(sp, R) {
  var saved = null; try { saved = +localStorage.getItem('pe_right_w'); } catch (e) {}
  paneSet(R, saved || PANE_DEFAULT, false);
  sp.addEventListener('pointerdown', function (e) {
    e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag'); document.body.classList.add('resizing');
    var move = function (ev) { paneSet(R, window.innerWidth - ev.clientX, false); };
    var up = function (ev) {
      sp.releasePointerCapture(e.pointerId); sp.classList.remove('drag'); document.body.classList.remove('resizing');
      sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up);
      paneSet(R, window.innerWidth - ev.clientX, true);
    };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('dblclick', function () { paneSet(R, PANE_DEFAULT, true); });
  sp.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    paneSet(R, R.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 24 : -24), true);
  });
  window.addEventListener('resize', function () { paneSet(R, R.getBoundingClientRect().width, false); });
}

// ---- patient drum: a rotating up/down picker; the current patient sits in the window, its neighbours roll above and below
var DRUM_ROW = 33;
function drumPose(o) {
  var a = Math.abs(o);
  var y = Math.sign(o) * (a <= 1 ? a * DRUM_ROW : DRUM_ROW + (a - 1) * 20);
  return 'transform:translateY(' + y + 'px) rotateX(' + (-Math.max(-2.2, Math.min(2.2, o)) * 42) + 'deg);opacity:' + (a === 0 ? 1 : a <= 1 ? .72 : 0);
}
function drumHtml(pts, stOf) {
  var idx = Math.max(0, pts.findIndex(function (p) { return p.id === S.pt; }));
  var from = S.drumLast == null || S.drumLast >= pts.length ? idx : S.drumLast;
  var lo = Math.max(0, Math.min(from, idx) - 3), hi = Math.min(pts.length - 1, Math.max(from, idx) + 3), rows = '';
  for (var i = lo; i <= hi; i++) {
    var p = pts[i], st = stOf(p), left = st.n - st.d;
    rows += '<button type="button" class="drum-row' + (i === idx ? ' on' : '') + '" data-drum="' + i + '" tabindex="-1" style="' + drumPose(i - from) + '"' + (i === idx ? ' aria-current="true"' : '') + '>' +
      '<span class="dn">' + esc(p.label) + '</span>' +
      '<span class="dl">' + (!st.n ? 'No predictions' : st.done ? '<svg width="15" height="15" viewBox="0 0 16 16" aria-label="All reviewed"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#5A8233" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : left + ' left') + '</span></button>';
  }
  S.drumAnim = from !== idx ? idx : null;
  S.drumLast = idx;
  return '<div class="drum" tabindex="0" aria-label="Patient ' + esc((pts[idx] || {}).label || '') + ': scroll, swipe or use the up and down arrow keys to change patient, ">' +
    '<span class="drum-win" aria-hidden="true"></span>' + rows +
    (pts.length > 1 ? '<span class="drum-hint" aria-hidden="true"><svg width="12" height="16" viewBox="0 0 12 16"><path d="M3 6l3-3 3 3M3 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '') +
    '</div>';
}
function drumSettle() {
  if (S.drumAnim == null) return;
  var idx = S.drumAnim; S.drumAnim = null;
  var rows = document.querySelectorAll('#right .drum-row');
  if (rows[0]) void rows[0].offsetHeight;
  requestAnimationFrame(function () { rows.forEach(function (r) { r.setAttribute('style', drumPose(+r.dataset.drum - idx)); }); });
}
function drumGo(dir) {
  var ps = S.art.patients, i = ps.findIndex(function (p) { return p.id === S.pt; }), j = i + dir;
  if (j < 0 || j >= ps.length) return;
  switchPt(ps[j].id);
  var d = document.querySelector('#right .drum'); if (d) d.focus({ preventScroll: true });
}

// ---- right pane
function renderRight() {
  var el = document.getElementById('right'), sc = el.scrollTop, pts = S.art.patients, mine = minePt(S.pt);
  var cur = S.ptById[S.pt] || { label: '' };
  var stOf = function (p) { var ms = minePt(p.id), d = ms.filter(function (m) { return status(m) !== 'pending'; }).length; return { n: ms.length, d: d, pct: ms.length ? Math.round(100 * d / ms.length) : 0, done: ms.length > 0 && d === ms.length }; };
  var subOf = function (p) { var ms = minePt(p.id), d = ms.filter(function (m) { return status(m) !== 'pending'; }).length; return ms.length ? d + '/' + ms.length + ' done' : 'No predictions'; };
  var h = '<div style="padding:16px 18px 60px;display:flex;flex-direction:column;gap:14px">' +
    '<div class="sechdr"><span class="sh-t">Patient</span><span class="sh-line" aria-hidden="true"></span></div>' +
    drumHtml(pts, stOf);
  if (S.ptMenu) {
    h += '<div class="ptlist" role="listbox" aria-label="All patients">' + pts.map(function (p, k) {
      var st = stOf(p), left = st.n - st.d;
      return '<button type="button" role="option" aria-selected="' + (p.id === S.pt) + '" class="ptli' + (p.id === S.pt ? ' on' : '') + (st.done ? ' done' : '') + '" data-pt="' + p.id + '">' +
        '<span class="pn">' + esc(p.label) + '</span>' +
        '<span class="pl">' + (!st.n ? 'No predictions' : st.done ? '<svg width="15" height="15" viewBox="0 0 16 16" aria-label="All reviewed"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#5A8233" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : left + ' left') + '</span></button>';
    }).join('') + '</div>';
  }
  h += '<div class="sechdr" style="padding-top:4px"><h2 class="sh-t">Phenotype mentions</h2><span class="sh-line" aria-hidden="true"></span></div>';
  if (S.sel) h += mentionCard(S.byId[S.sel]);
  else if (S.selAdd) { var x = S.art.added.find(function (a) { return a.added_id === S.selAdd; }); if (x) h += addedCard(x); }
  else {
    if (!mine.length) h += '<div style="padding:14px;border-radius:12px;border:1px dashed #C9C6BF;font-size:14px;color:#5F6670;text-align:center">No predicted phenotypes for this patient. You can still add missed ones below.</div>';
    else {
      var nextP = mine.find(function (m) { return status(m) === 'pending'; });
      if (nextP) h += '<div class="insp-empty"><span>Select a highlighted mention in the text to review it here.</span><button type="button" class="savebtn blkbtn" data-a="reviewnext">Review next mention →</button></div>';
      else h += allDecidedBox();
    }
  }
  h += addBox();
  h += profileHtml();
  var act = document.activeElement, keepId = act && el.contains(act) && act.id && /^(input|textarea)$/i.test(act.tagName) ? act.id : null;
  var keepSel = keepId ? [act.selectionStart, act.selectionEnd] : null;
  el.innerHTML = h + '</div>';
  el.scrollTop = sc;
  if (keepId && !S.focus) { var back = document.getElementById(keepId); if (back) { back.focus({ preventScroll: true }); try { back.setSelectionRange(keepSel[0], keepSel[1]); } catch (e) {} } }
  drumSettle();
  var pl = el.querySelector('.ptlist'), plOn = pl && pl.querySelector('.ptli.on');
  if (plOn && !pl.dataset.placed) { pl.scrollTop = plOn.offsetTop - pl.clientHeight / 2 + plOn.offsetHeight / 2; pl.dataset.placed = 1; }
  ['q', 'aq', 'eq', 'ptq', 'reid'].forEach(function (id) { var i = document.getElementById(id); if (i && S.focus === id) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} } });
  S.focus = null;
}
// next patient (in patient order, after the current one) that still has mentions to review, and its first one in the text
function nextPatientMention() {
  var ps = S.art.patients, i = ps.findIndex(function (p) { return p.id === S.pt; });
  for (var k = 1; k < ps.length; k++) {
    var p = ps[(i + k) % ps.length], first = minePt(p.id).find(function (m) { return status(m) === 'pending'; });
    if (first) return first;
  }
  return null;
}
function allDecidedBox() {
  var other = nextPatientMention();
  var ok = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="#2F7D5B" stroke-width="1.6"/><path d="M5.5 9.3l2.3 2.3 4.7-4.8" fill="none" stroke="#2F7D5B" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (other) return '<div class="insp-empty"><span>All predictions for ' + esc((S.ptById[S.pt] || {}).label) + ' are decided.</span>' +
    '<button type="button" class="savebtn blkbtn" data-a="nextpt">Continue with ' + esc((S.ptById[effPt(other) || other.pt] || {}).label) + '</button></div>';
  return '<div class="insp-empty"><span>Every prediction in this article has a decision.</span>' +
    '<a class="savebtn blkbtn" href="#/r/' + S.pmid + '" style="text-decoration:none">Review &amp; submit</a></div>';
}
function switchPt(pt) { S.pt = pt; S.sel = null; S.selAdd = null; S.rev = null; S.re = null; S.edit = null; S.ptMenu = false; renderAll(); }

function refCard(id, kicker) {
  var t = termCache[id] || { label: id };
  var rows = '<div class="rc-row"><dt>' + IC.book + 'Definition</dt><dd class="rc-def">' + esc(t.def || 'No definition in HPO.') + '</dd></div>' +
    '<div class="rc-row"><dt>' + IC.tag + 'Synonyms</dt><dd style="display:flex;flex-wrap:wrap;gap:5px">' + ((t.syn || []).length ? t.syn.map(function (s) { return '<span class="syn">' + esc(s) + '</span>'; }).join('') : '<span style="font-size:13px;color:#5F6670">None listed in HPO</span>') + '</dd></div>';
  if (t.parents) rows += '<div class="rc-row"><dt>Parent</dt><dd style="display:flex;flex-direction:column;align-items:flex-start;gap:3px">' + (t.parents.length ? t.parents.map(function (p) { return '<span class="kid"><span>' + esc(p.label) + '</span><span class="mono">' + p.id + '</span></span>'; }).join('') : '<span class="kid"><span>None (top level)</span></span>') + '</dd></div>';
  if (t.children) rows += '<div class="rc-row"><dt>Children</dt><dd style="display:flex;flex-direction:column;align-items:flex-start;gap:3px">' + (t.children.length ? t.children.map(function (p) { return '<span class="kid"><span>' + esc(p.label) + '</span><span class="mono">' + p.id + '</span></span>'; }).join('') : '<span style="font-size:13px;color:#5F6670">None: this is a most specific term</span>') + '</dd></div>';
  return '<section class="refcard" aria-label="HPO term"><div class="rc-head"><span class="rc-kicker">' + kicker + '</span><div class="rc-title"><span class="rc-name">' + esc(t.label) + '</span><a class="rc-id" href="https://hpo.jax.org/browse/term/' + id + '" target="_blank" rel="noopener">' + id + ' ↗</a></div></div><dl class="rc-body">' + rows + '</dl></section>';
}

// folder tabs: several mentions of the same phenotype (same term) for this patient
function termKey(m) {
  var d = dec(m);
  if (d && d.decision === 'revise') return d.final_hpo_id;
  if (d && d.decision === 'no_code') return 'nc:' + m.id;
  return m.t || ('u:' + m.id);
}
function tabsHtml(key, curKind, curId) {
  var items = [];
  S.art.mentions.forEach(function (m) { if (effPt(m) === S.pt && termKey(m) === key) items.push({ k: 'm', id: m.id, text: m.cell ? (m.x || m.text) : m.text, st: status(m) }); });
  S.art.added.forEach(function (x) { if (x.patient_id === S.pt && x.hpo_id === key) items.push({ k: 'x', id: x.added_id, text: x.span_text, st: 'added' }); });
  if (items.length < 2) return '';
  return '<div class="ftabs" role="tablist" aria-label="Evidence spans for this term">' + items.map(function (it) {
    var on = it.k === curKind && String(it.id) === String(curId), t = it.text.length > 30 ? it.text.slice(0, 28) + '…' : it.text;
    return '<button type="button" role="tab" aria-selected="' + on + '" class="ftab' + (on ? ' on' : '') + '" ' + (it.k === 'm' ? 'data-tm="' + it.id + '"' : 'data-tx="' + it.id + '"') + '><span class="tdot ' + TDOT[it.st] + '" aria-hidden="true"></span><span>' + esc(t) + '</span></button>';
  }).join('') + '</div>';
}

function mentionCard(m) {
  var d = dec(m), st = status(m), revOpen = S.rev && S.rev.mid === m.id;
  var head = m.cell ? (m.x || m.text) : (differs(m) ? m.x : m.text);
  var h = '<div id="c-' + m.id + '" class="card card-sel">' + tabsHtml(termKey(m), 'm', m.id) + '<div class="cardhead"><span class="q">“' + esc(head) + '”</span><span class="badge ' + BADGE[st] + '">' + LABEL[st] + '</span>';
  if (!m.cell && differs(m)) h += '<span class="origtxt" title="Text in the article">“' + esc(m.text) + '”</span>';
  if (d && d.decision === 'revise' && m.t) h += '<span class="revtag" style="grid-column:1/-1">' + IC.pencil + 'Revised to ' + esc(lab(d.final_hpo_id)) + ' · ' + d.final_hpo_id + '</span>';
  if (d && d.decision === 'no_code' && m.t) h += '<span class="revtag" style="grid-column:1/-1;color:#4A515B;background:#EEF1F4;border-color:#D5DAE0">No fitting HPO term</span>';
  if (d && d.reassigned_to) h += '<span class="retag">' + IC.arrow + 'Reassigned to ' + esc(d.reassigned_to) + '</span>';
  h += '</div><div class="cbody">';
  var ref = m.t || (d && d.decision === 'revise' ? d.final_hpo_id : null);
  if (ref) h += refCard(ref, m.t ? 'Predicted term' : 'Revised term');
  else h += '<section class="vacant" aria-label="No predicted HPO term">' + IC.vacant + '<div class="vac-b"><span class="rc-kicker">Predicted term</span><span class="vac-t">No HPO term predicted</span><span class="vac-s">' +
    (m.x ? 'The pipeline extracted “' + esc(m.x) + '” but found no HPO term that fits it.' : 'The pipeline found no HPO term that fits this mention.') + '</span></div></section>';
  var top = revOpen ? 'revise' : st === 'accept' ? 'accept' : st === 'no_code' ? (m.t ? 'revise' : 'confirm') : st === 'revise' ? 'revise' : st === 'reject' ? 'reject' : null;
  var dc = function (k) { return 'dec dec-' + k + (top === k ? ' on-' + k : ''); };
  h += '<div role="group" class="decs">' + (m.t
    ? '<button type="button" class="' + dc('accept') + '" data-a="accept" data-key="z" title="Accept (Z key)"><span class="t">' + IC.accept + 'Accept<kbd class="kk kk-z">Z</kbd></span><span class="s">The HPO term fits</span></button>'
    : '<button type="button" class="' + dc('confirm') + '" data-a="nocode" data-key="z" title="Confirm (Z key)"><span class="t">' + IC.confirm + 'Confirm<kbd class="kk kk-z">Z</kbd></span><span class="s">No fitting HPO term</span></button>') +
    '<button type="button" class="' + dc('revise') + '" data-a="revise" data-key="x" title="Revise (X key)"><span class="t">' + IC.revise + 'Revise<kbd class="kk kk-x">X</kbd></span><span class="s">Find a fitting HPO term</span></button>' +
    '<button type="button" class="' + dc('reject') + '" data-a="reject" data-key="c" title="Reject (C key)"><span class="t">' + IC.reject + 'Reject<kbd class="kk kk-c">C</kbd></span><span class="s">Not a patient phenotype</span></button></div>';
  if (revOpen) h += reviseBox(m);
  var showPt = top !== 'reject';
  if (showPt && S.re) h += reassignBox(m);
  h += '<div class="cfoot"><div>' + (showPt ? '<button type="button" class="ghostbtn" data-a="reopen" aria-expanded="' + !!S.re + '">' + IC.person + (d && d.reassigned_to ? 'Change patient' : 'Wrong patient?') + '</button>' : '') +
    (st !== 'pending' ? '<button type="button" class="ghostbtn br" data-a="clear">Clear</button>' : '') + '</div>' +
    '<div><button type="button" class="ghostbtn br" data-a="close" style="margin-right:6px">Close</button><button type="button" class="keycap" data-a="prev" title="Previous mention (← or &lt; key)" aria-label="Previous mention">&lt;</button><button type="button" class="keycap" data-a="next" title="Next mention to review (→ or &gt; key)" aria-label="Next mention to review">&gt;</button></div></div>';
  return h + '</div></div>';
}

function optHtml(id, o) {
  var t = termCache[id] || { label: id };
  return '<button type="button" class="opt' + (o.cur ? ' current' : o.on ? ' chosen' : '') + '" ' + (o.cur ? 'disabled' : o.attr + '="' + id + '"') + ' aria-pressed="' + !!o.on + '"><span class="rad"></span><span style="display:flex;flex-direction:column;gap:3px;min-width:0">' +
    '<span style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;font-weight:500">' + esc(t.label) + '</span><span class="mono">' + id + '</span>' + (o.cur ? '<span style="font-size:11.5px;color:#5F6670">Predicted term</span>' : '') + '</span>' +
    (t.def ? '<span style="font-size:12.5px;line-height:1.45;color:#4A5059">' + esc(t.def) + '</span>' : '') +
    '<span style="font-size:12px;line-height:1.45;color:#5F6670">Synonyms: ' + esc((t.syn || []).join(' · ') || 'none listed') + '</span>' +
    (o.matched ? '<span style="font-size:11.5px;color:#8A5A0B">Matched synonym “' + esc(o.matched) + '”</span>' : '') + '</span></button>';
}
function vtog() { return '<div role="group" aria-label="View" class="vtog"><button type="button" class="seg' + (S.view === 'list' ? ' on' : '') + '" data-view="list">List</button><button type="button" class="seg' + (S.view === 'tree' ? ' on' : '') + '" data-view="tree">Lineage</button></div>'; }
function showSel(id) {
  return '<label class="showsel"><span>Show</span><select id="' + id + '" class="selbox">' + ['10', '30', '50', 'all'].map(function (v) { return '<option value="' + v + '"' + (S.maxRes === v ? ' selected' : '') + '>' + (v === 'all' ? 'All' : v) + '</option>'; }).join('') + '</select></label>';
}
function resCount(res) {
  if (!res) return 'Type at least 2 characters';
  var n = res.results.length;
  return (res.total > n ? n + ' of ' + res.total : n) + (res.total === 1 ? ' result' : ' results');
}
function pageSize() { return S.maxRes === 'all' ? 50 : +S.maxRes; }
function moreBtn(res, act) {
  var left = res ? res.total - res.results.length : 0;
  return left > 0 ? '<button type="button" class="morebtn" data-a="' + act + '">Load ' + Math.min(pageSize(), left) + ' more · ' + left + ' not shown</button>' : '';
}
// search results block (list or lineage), used by Revise (q), the Add form (aq) and the edit form of an added phenotype (eq)
function searchBlock(res, o) {
  var h = '<div class="steprow"><span style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="font-size:12.5px;color:#5F6670">' + resCount(res) + '</span>' + showSel(o.sel) + '</span>' + vtog() + '</div>';
  if (res) res.results.forEach(function (t) { termCache[t.id] = Object.assign(termCache[t.id] || {}, t); });
  var ids = res ? res.results.map(function (t) { return t.id; }) : [];
  if (S.view === 'tree') h += treeHtml(ids.concat(o.chosen ? [o.chosen] : []), { pred: o.pred, chosen: o.chosen, attr: o.attr, empty: 'Search to see where the terms sit in HPO.', rerender: o.rerender });
  else if (res && res.results.length) h += '<div class="reslist">' + res.results.map(function (t) { return optHtml(t.id, { attr: o.attr, on: o.chosen === t.id, matched: t.matched }); }).join('') + '</div>';
  h += moreBtn(res, o.more);
  if (res && !res.results.length) h += '<span style="font-size:13px;color:#5F6670">No matching terms. Try a synonym or a broader word.</span>';
  return h;
}
function reviseBox(m) {
  // switcher: Candidates | Search HPO (replaces the step bar and the Search HPO / Back buttons)
  var r = S.rev, h = '<div class="revbox"><div role="tablist" aria-label="Find a fitting HPO term" class="revtabs">' +
    '<button type="button" role="tab" aria-selected="' + (r.step === 'cand') + '" class="seg' + (r.step === 'cand' ? ' on' : '') + '" data-a="tocand">Candidates</button>' +
    '<button type="button" role="tab" aria-selected="' + (r.step === 'search') + '" class="seg' + (r.step === 'search' ? ' on' : '') + '" data-a="tosearch">Search HPO</button></div>';
  if (r.step === 'cand') {
    h += '<div style="display:flex;flex-direction:column;gap:8px"><div class="steprow"><span class="steptitle">Select the correct term among the candidates</span>' + vtog() + '</div>';
    h += S.view === 'tree'
      ? treeHtml(m.c.slice(), { pred: m.t, chosen: r.term, attr: 'data-pick', empty: 'No candidates for this mention: search the HPO.', rerender: renderRight })
      : (m.c.length ? '<div class="reslist">' + m.c.map(function (id) { return optHtml(id, { attr: 'data-pick', cur: id === m.t, on: r.term === id }); }).join('') + '</div>' : '<span style="font-size:13px;color:#5F6670">No candidates for this mention: search the HPO.</span>');
    h += '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap"><button type="button" class="savebtn blkbtn' + (r.term ? '' : ' off') + '" data-a="confirmrev">Confirm</button></div></div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px"><label for="q" class="steptitle">Search the whole HPO by name, synonym or ID</label><input id="q" class="field" type="search" value="' + esc(S.q) + '" placeholder="e.g. ectropion, HP:0000656" autocomplete="off">' +
      '<div id="res" style="display:flex;flex-direction:column;gap:8px">' + searchBlock(S.res, { sel: 'maxres', attr: 'data-pick', chosen: r.term, pred: m.t, more: 'more', rerender: renderRight }) + '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap"><button type="button" class="nofitbtn" data-a="nocode" title="Neither the candidates nor the search give a fitting term: record this mention as ungrounded">No fitting HPO term</button><button type="button" class="savebtn blkbtn' + (r.term ? '' : ' off') + '" data-a="confirmrev">Confirm</button></div></div>';
  }
  return h + '</div>';
}
function reassignBox(m) {
  var d = dec(m), cur = effPt(m), re = S.re, moved = !!(d && d.reassigned_to);
  // once reassigned, the pipeline's patient is not offered again: going back is done with Undo reassignment
  var opts = S.art.patients.filter(function (p) { return p.id !== cur && !(moved && p.id === m.pt); });
  var h = '<div class="rebox"><span class="steptitle">Whose phenotype is this?</span><span class="stephint">Choose the right patient. If the person is not in the list (e.g. another case or a relative), choose Someone else and enter their identifier exactly as the article writes it.</span><div class="reopts">';
  h += opts.map(function (p) { return '<button type="button" class="opt' + (re.choice === p.id ? ' chosen' : '') + '" data-re="' + p.id + '"><span class="rad"></span><span style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;font-weight:500">' + esc(p.label) + '</span></span></button>'; }).join('');
  h += '<button type="button" class="opt' + (re.choice === 'other' ? ' chosen' : '') + '" data-re="other"><span class="rad"></span><span style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;font-weight:500">Someone else</span><span style="font-size:12.5px;color:#5F6670">not in the list</span></span></button></div>';
  var blocked = false;
  if (re.choice === 'other') {
    var match = matchPatient(re.text), msg = '';
    if (match && moved && match.id === m.pt) { blocked = true; msg = esc(match.label) + ', the patient this phenotype came from. To move it back, use Undo reassignment.'; }
    else if (match) msg = esc(match.label) + ', who is in the list' + (match.id === cur ? ' and already has this phenotype. Nothing will change.' : '. The phenotype will be assigned to ' + esc(match.label) + '.');
    h += '<div style="display:flex;flex-direction:column;gap:6px;padding-left:28px"><label for="reid" style="font-size:13px;font-weight:500">Patient identifier</label><input id="reid" class="field" type="text" value="' + esc(re.text || '') + '" placeholder="e.g. Patient 4, II-3, mother">' +
      (match ? '<div role="status" class="warn">' + IC.warn + '<span>“' + esc(re.text.trim()) + '” is ' + msg + '</span></div>' : '') + '</div>';
  }
  var ok = re.choice && (re.choice !== 'other' || (re.text || '').trim()) && !blocked;
  h += '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:2px">' + (d && d.reassigned_to ? '<button type="button" class="ghostbtn" data-a="undore" style="color:#5F6670">Undo reassignment</button>' : '') + '<span style="flex:1"></span><button type="button" class="ghostbtn" data-a="cancelre">Cancel</button><button type="button" class="savebtn' + (ok ? '' : ' off') + '" data-a="savere">Reassign</button></div>';
  return h + '</div>';
}
function matchPatient(text) {
  var n2 = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  if (!n2(text)) return null;
  return S.art.patients.find(function (p) { return n2(p.label) === n2(text) || n2(p.label).replace(/^patient/, '') === n2(text) || p.aliases.some(function (a) { return n2(a) === n2(text); }); }) || null;
}

function addedCard(x) {
  var editing = S.edit && S.edit.id === x.added_id;
  var h = '<div id="m-' + x.added_id + '" class="card card-sel">' + tabsHtml(x.hpo_id, 'x', x.added_id) + '<div class="cardhead"><span class="q">“' + esc(x.span_text) + '”</span><span class="badge b-added">Added</span></div>' +
    '<div class="cbody">' + refCard(x.hpo_id, 'Added term') +
    '<div role="group" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"><button type="button" class="dec dec-revise' + (editing ? ' on-revise' : '') + '" data-a="editadd"><span class="t">' + IC.revise + 'Revise</span><span class="s">Change the span or term</span></button>' +
    '<button type="button" class="dec dec-reject" data-a="removeadd"><span class="t">' + IC.remove + 'Remove</span><span class="s">Delete this phenotype</span></button></div>';
  if (editing) {
    var e = S.edit;
    h += '<div class="revbox addbox-edit" style="display:flex;flex-direction:column;gap:10px"><span class="steptitle">Revise missed phenotype</span>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:600">Evidence span</span>' +
      '<div style="display:flex;gap:6px;align-items:stretch"><div id="espan" class="spanbox' + (e.span ? '' : ' empty') + '" aria-live="polite">' + (e.span ? '“' + esc(e.span) + '”' : 'Select the words in the article text, then press Use selection.') + '</div>' +
      '<button type="button" class="ghostbtn br" data-a="eusesel" style="flex:none">Use selection</button></div>' +
      (e.selErr ? '<span class="spanerr">' + esc(e.selErr) + '</span>' : '') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><label for="eq" style="font-size:13px;font-weight:600">HPO term</label><input id="eq" class="field" type="search" value="' + esc(e.q) + '" placeholder="Search by name, synonym or ID" autocomplete="off">' +
      '<div id="eres" style="display:flex;flex-direction:column;gap:8px">' + searchBlock(e.res, { sel: 'emaxres', attr: 'data-epick', chosen: e.term, more: 'emore', rerender: renderRight }) + '</div></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="ghostbtn" data-a="canceledit">Cancel</button><button type="button" class="savebtn blkbtn' + (e.loc && e.term ? '' : ' off') + '" data-a="saveedit">Confirm</button></div></div>';
  }
  return h + '<div style="display:flex;justify-content:flex-end;gap:2px;padding-top:4px;border-top:1px solid #EEECE7"><button type="button" class="ghostbtn br" data-a="close">Close</button></div></div></div>';
}
function addBox() {
  var a = S.add;
  var h = '<div class="addbox"><button type="button" class="ghostbtn addbtn" data-a="toggleadd">' + IC.plus + 'Add a missed phenotype</button>';
  if (a) {
    h += '<div style="display:flex;flex-direction:column;gap:10px"><p style="margin:0;font-size:13.5px;line-height:1.55;color:#4A5059">Select the words in the article text (one paragraph or one table cell) and press Use selection, then search the fitting term in HPO.</p>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:600">Evidence span</span>' +
      '<div style="display:flex;gap:6px;align-items:stretch"><div id="aspan" class="spanbox' + (a.span ? '' : ' empty') + '" aria-live="polite">' + (a.span ? '“' + esc(a.span) + '”' : 'Select the words in the article text, then press Use selection.') + '</div>' +
      '<button type="button" class="ghostbtn br" data-a="usesel" style="flex:none">Use selection</button></div>' +
      (a.selErr ? '<span class="spanerr">' + esc(a.selErr) + '</span>' : '') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><label for="aq" style="font-size:13px;font-weight:600">HPO term</label><input id="aq" class="field" type="search" value="' + esc(a.q) + '" placeholder="Search by name, synonym or ID" autocomplete="off">' +
      '<div id="ares" style="display:flex;flex-direction:column;gap:8px">' + searchBlock(a.res, { sel: 'amaxres', attr: 'data-apick', chosen: a.term, more: 'amore', rerender: renderRight }) + '</div></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="ghostbtn" data-a="canceladd">Cancel</button><button type="button" class="savebtn blkbtn' + (a.loc && a.term ? '' : ' off') + '" data-a="saveadd">Confirm</button></div></div>';
  }
  return h + '</div>';
}

function profileHtml() {
  var groups = [], byG = {}, byKey = {};
  function put(g, key, item, gap) {
    if (!byG[g]) { byG[g] = { label: g, items: [], gap: gap }; groups.push(byG[g]); }
    if (!byKey[key]) { byKey[key] = item; item.n = 0; item.on = false; byG[g].items.push(item); }
    byKey[key].n++;
    return byKey[key];
  }
  minePt(S.pt).forEach(function (m) {
    if (effPt(m) !== S.pt) return;
    var d = dec(m), st = status(m);
    if (st === 'pending' || st === 'reject') return; // the profile is built from decided mentions
    var it;
    if (st === 'no_code') it = put('No HPO term (ontology gap)', 'nc:' + m.id, { label: m.x || m.text, cls: 'c-ghost', m: m.id }, true);
    else it = put(primarySystem(termCache[d.final_hpo_id]), d.final_hpo_id, { label: lab(d.final_hpo_id), cls: st === 'revise' ? 'c-revise' : 'c-accept', m: m.id });
    if (S.sel === m.id) it.on = true;
  });
  S.art.added.forEach(function (x) {
    if (x.patient_id !== S.pt) return;
    var it = put(primarySystem(termCache[x.hpo_id]), x.hpo_id, { label: lab(x.hpo_id), cls: 'c-added', x: x.added_id });
    if (S.selAdd === x.added_id) it.on = true;
  });
  if (!groups.length) return '';
  groups.sort(function (a, b) { return (a.gap ? 1 : 0) - (b.gap ? 1 : 0); });
  return '<div class="sechdr" style="padding:8px 0 0"><h2 class="sh-t" style="margin:0">Phenotypic profile</h2><span class="sh-line" aria-hidden="true"></span></div><section class="prof" aria-label="Phenotypic profile">' +
    groups.map(function (g) {
      return '<div class="pgrp"><span class="pg-l">' + esc(g.label) + '</span><div class="pg-chips">' + g.items.map(function (c) {
        return '<span class="pcw"><button type="button" class="pc ' + c.cls + (c.on ? ' on' : '') + '" ' + (c.m ? 'data-pm="' + c.m + '"' : 'data-px="' + c.x + '"') + ' title="' + esc(c.label) + '">' + esc(c.label) + '</button>' + (c.n > 1 ? '<span class="pcn" title="' + c.n + ' evidence spans in the text">×' + c.n + '</span>' : '') + '</span>';
      }).join('') + '</div></div>';
    }).join('') + '<div class="pkey"><span class="pc c-accept">Accepted</span><span class="pc c-revise">Revised</span><span class="pc c-added">Added</span><span class="pc c-ghost">No code</span></div></section>';
}

// ---- lineage view: only the listed terms, nested by their HPO relationship
function needLineage(ids, rerender) {
  var miss = [];
  (function walk(list) { list.forEach(function (id) { if (!id) return; if (!lineage[id]) { miss.push(id); return; } walk(lineage[id].parents); }); })(ids);
  miss = miss.filter(function (id, i) { return miss.indexOf(id) === i; });
  if (!miss.length) return true;
  var ask = miss.filter(function (id) { return !lineageWaiting[id]; });
  if (ask.length) {
    ask.forEach(function (id) { lineageWaiting[id] = true; });
    api('GET', '/api/hpo/lineage?ids=' + encodeURIComponent(ask.join(','))).then(function (r) {
      Object.keys(r.nodes).forEach(function (k) { lineage[k] = r.nodes[k]; });
      ask.forEach(function (id) { delete lineageWaiting[id]; if (!lineage[id]) lineage[id] = { label: id, parents: [] }; });
      rerender();
    }).catch(function () { ask.forEach(function (id) { delete lineageWaiting[id]; }); });
  }
  return false;
}
function treeHtml(targets, o) {
  targets = targets.filter(function (t, i) { return t && targets.indexOf(t) === i; });
  if (!targets.length) return '<span style="font-size:13px;color:#5F6670;padding:4px 6px">' + (o.empty || '') + '</span>';
  if (!needLineage(targets, o.rerender)) return '<div class="tree"><span style="font-size:13px;color:#5F6670">Loading…</span></div>';
  var anc = {};
  function ancestors(id) {
    if (anc[id]) return anc[id];
    var out = {};
    (function up(list) { list.forEach(function (p) { if (out[p] || !lineage[p]) return; out[p] = true; up(lineage[p].parents); }); })((lineage[id] || { parents: [] }).parents);
    return (anc[id] = out);
  }
  var depthOf = function (id) { return Object.keys(ancestors(id)).length; };
  var parentOf = {};
  targets.forEach(function (t) { var a = ancestors(t), best = null; targets.forEach(function (u) { if (u !== t && a[u] && (!best || depthOf(u) > depthOf(best))) best = u; }); parentOf[t] = best; });
  var kids = {}, roots = [];
  targets.forEach(function (t) { if (parentOf[t]) (kids[parentOf[t]] = kids[parentOf[t]] || []).push(t); else roots.push(t); });
  var common = null;
  targets.forEach(function (t) { var a = Object.assign({}, ancestors(t)); a[t] = true; common = common ? Object.keys(common).reduce(function (o2, k) { if (a[k]) o2[k] = true; return o2; }, {}) : a; });
  var crumb = Object.keys(common || {}).filter(function (k) { return k !== 'HP:0000001' && k !== 'HP:0000118' && targets.indexOf(k) < 0; }).sort(function (a, b) { return depthOf(a) - depthOf(b); });
  var byLabel = function (a, b) { return (lineage[a].label || '').localeCompare(lineage[b].label || ''); };
  var rows = '';
  (function walk(list, depth) {
    list.sort(byLabel).forEach(function (n) {
      var role = n === o.chosen ? 'chosen' : n === o.pred ? 'pred' : 'cand';
      var inner = '<span class="mk mk-' + role + '"></span><span class="tl">' + esc(lineage[n].label) + '</span><span class="mono">' + n + '</span>' +
        (role === 'pred' ? '<span class="ttag tt-pred">Predicted</span>' : role === 'chosen' ? '<span class="ttag tt-chosen">Your choice</span>' : '');
      rows += '<div class="trow" role="treeitem" aria-level="' + (depth + 1) + '"><span class="ind" style="width:' + depth * 18 + 'px" aria-hidden="true"></span>' +
        (n !== o.pred ? '<button type="button" class="tbtn' + (role === 'chosen' ? ' chosen' : '') + '" ' + o.attr + '="' + n + '">' + inner + '</button>' : '<span class="tnode">' + inner + '</span>') + '</div>';
      walk(kids[n] || [], depth + 1);
    });
  })(roots, 0);
  return '<div class="tree" role="tree">' + (crumb.length ? '<div class="crumb">' + crumb.map(function (c) { return esc(lineage[c].label); }).join(' › ') + ' ›</div>' : '') + rows + '</div>';
}

// ---- saving and actions
function saveDecision(m, body, after, next) {
  body.mention_id = m.id; body.client_at = nowIso();
  return api('POST', '/api/articles/' + S.pmid + '/decision', body).then(function (r) {
    addTerms(r.terms);
    if (r.decision) S.art.decisions[m.id] = r.decision; else delete S.art.decisions[m.id];
    if (after) after();
    if (next) { renderLeft(); renderTop(); advance(m.id); return; }
    var f = r.decision && r.decision.final_hpo_id;
    if (f && !(termCache[f] || {}).children) getTerm(f).then(function () { renderRight(); }).catch(function () {});
    renderAll();
  }).catch(function (e) { toast(e.message); });
}
// After Accept, Reject, Confirm or a confirmed revision: close the card and open the next mention still to review
// for this patient (in text order). If there is none, the card just closes.
function advance(fromId) {
  var list = minePt(S.pt), i = list.findIndex(function (m) { return m.id === fromId; });
  for (var k = 1; k <= list.length; k++) {
    var c = list[(i + k + list.length) % list.length];
    if (c.id !== fromId && status(c) === 'pending') { select(c.id, false); return; }
  }
  S.sel = null; S.rev = null; S.re = null; renderAll();
}
function step(dir) {
  var list = minePt(S.pt); if (!list.length) return;
  var i = list.findIndex(function (m) { return m.id === S.sel; }), n = null;
  if (dir > 0) for (var k = 1; k <= list.length; k++) { var c = list[(i + k + list.length) % list.length]; if (c.id !== S.sel && status(c) === 'pending') { n = c; break; } }
  if (!n) n = list[(i + dir + list.length) % list.length];
  select(n.id, false);
}
var searchTimer = null;
var searchSeq = 0;
function runSearch(q, cb, now) {
  clearTimeout(searchTimer);
  var seq = ++searchSeq;
  if (q.trim().length < 2) { cb(null); return; }
  searchTimer = setTimeout(function () {
    api('GET', '/api/hpo/search?q=' + encodeURIComponent(q) + '&limit=' + pageSize() * S.pages)
      .then(function (r) { if (seq === searchSeq) cb(r); })   // a newer query was typed meanwhile: ignore this answer
      .catch(function () {});
  }, now ? 0 : 300);
}
function refreshRes(which) {
  if (which === 'q') { var el = document.getElementById('res'), m = S.byId[S.rev.mid]; if (el) el.innerHTML = searchBlock(S.res, { sel: 'maxres', attr: 'data-pick', chosen: S.rev.term, pred: m.t, more: 'more', rerender: renderRight }); }
  if (which === 'aq') { var a = document.getElementById('ares'); if (a) a.innerHTML = searchBlock(S.add.res, { sel: 'amaxres', attr: 'data-apick', chosen: S.add.term, more: 'amore', rerender: renderRight }); }
  if (which === 'eq') { var e = document.getElementById('eres'); if (e) e.innerHTML = searchBlock(S.edit.res, { sel: 'emaxres', attr: 'data-epick', chosen: S.edit.term, more: 'emore', rerender: renderRight }); }
  var b = document.querySelector('[data-a="saveadd"]'); if (b && S.add) b.classList.toggle('off', !(S.add.loc && S.add.term));
  var c = document.querySelector('[data-a="saveedit"]'); if (c && S.edit) c.classList.toggle('off', !(S.edit.loc && S.edit.term));
  document.querySelectorAll('[data-a="confirmrev"]').forEach(function (x) { x.classList.toggle('off', !(S.rev && S.rev.term)); });
}
function search(which, now) {
  var q = which === 'q' ? S.q : which === 'aq' ? S.add.q : S.edit.q;
  runSearch(q, function (r) { if (which === 'q') S.res = r; else if (which === 'aq') S.add.res = r; else S.edit.res = r; refreshRes(which); }, now);
}
function onRightInput(e) {
  var t = e.target;
  if (t.id === 'q') { S.q = t.value; S.pages = 1; search('q'); }
  if (t.id === 'aq') { S.add.q = t.value; S.pages = 1; search('aq'); }
  if (t.id === 'eq') { S.edit.q = t.value; S.pages = 1; search('eq'); }
  if (t.id === 'ptq') { S.ptQ = t.value; S.focus = 'ptq'; renderRight(); }
  if (t.id === 'reid') { S.re.text = t.value; S.focus = 'reid'; renderRight(); }
}
function onRightChange(e) {
  var map = { maxres: 'q', amaxres: 'aq', emaxres: 'eq' }, w = map[e.target.id];
  if (w) { S.maxRes = e.target.value; S.pages = 1; search(w, true); }
}
function onRightClick(e) {
  var dr = e.target.closest('.drum-row');
  if (dr) {
    if (S.drumSwiped && Date.now() - S.drumSwiped < 400) return;
    var j = +dr.dataset.drum, ps = S.art.patients;
    if (ps[j] && ps[j].id !== S.pt) { switchPt(ps[j].id); var d0 = document.querySelector('#right .drum'); if (d0) d0.focus({ preventScroll: true }); }
    return;
  }
  var t = e.target.closest('[data-a],[data-pick],[data-apick],[data-epick],[data-re],[data-pm],[data-px],[data-tm],[data-tx],[data-view],[data-pt]');
  if (!t) return;
  var m = S.sel ? S.byId[S.sel] : null, d = m ? dec(m) : null;
  if (t.dataset.view) { S.view = t.dataset.view; renderRight(); return; }
  if (t.dataset.pt) { switchPt(t.dataset.pt); return; }
  if (t.dataset.pick) { S.rev.term = t.dataset.pick; S.rev.via = S.rev.step === 'cand' ? 'candidate' : 'search'; if (S.rev.step === 'search') refreshRes('q'); else renderRight(); return; }
  if (t.dataset.apick) { S.add.term = t.dataset.apick; refreshRes('aq'); return; }
  if (t.dataset.epick) { S.edit.term = t.dataset.epick; refreshRes('eq'); return; }
  if (t.dataset.re) { S.re.choice = t.dataset.re; if (t.dataset.re === 'other') S.focus = 'reid'; renderRight(); return; }
  if (t.dataset.tm || t.dataset.pm) { select(t.dataset.tm || t.dataset.pm, false); return; }
  if (t.dataset.tx || t.dataset.px) { openAdded(+(t.dataset.tx || t.dataset.px), true); return; }
  switch (t.dataset.a) {
    case 'ptmenu': S.ptMenu = !S.ptMenu; S.ptQ = ''; renderRight(); return;
    case 'ptprev': case 'ptnext': { var ps = S.art.patients, i = ps.findIndex(function (p) { return p.id === S.pt; }); switchPt(ps[(i + (t.dataset.a === 'ptnext' ? 1 : -1) + ps.length) % ps.length].id); return; }
    case 'reviewnext': { var n = minePt(S.pt).find(function (x) { return status(x) === 'pending'; }); if (n) select(n.id, false); return; }
    case 'nextpt': { var o = nextPatientMention(); if (o) { select(o.id, true); } return; }
    case 'accept': S.rev = null; saveDecision(m, { decision: 'accept' }, null, true); return;
    case 'reject': S.rev = null; S.re = null; saveDecision(m, { decision: 'reject' }, null, true); return;
    case 'nocode': saveDecision(m, { decision: 'no_code' }, function () { S.rev = null; }, true); return;
    case 'revise':
      S.re = null;
      if (S.rev && S.rev.mid === m.id) { S.rev = null; renderRight(); return; }
      S.rev = { mid: m.id, step: d && d.decision === 'revise' && d.revise_via === 'search' ? 'search' : 'cand', term: d && d.decision === 'revise' ? d.final_hpo_id : null, via: d && d.decision === 'revise' ? d.revise_via : null };
      if (S.rev.step === 'search') { S.q = lab(S.rev.term); S.pages = 1; search('q', true); }
      renderRight(); return;
    case 'tosearch': if (S.rev.step !== 'search') { S.rev.step = 'search'; S.focus = 'q'; renderRight(); } return;
    case 'tocand': if (S.rev.step !== 'cand') { S.rev.step = 'cand'; renderRight(); } return;
    case 'confirmrev':
      if (!S.rev.term) return;
      /* choosing the predicted term again is an Accept */
      if (S.rev.term === m.t) { saveDecision(m, { decision: 'accept' }, function () { S.rev = null; }, true); return; }
      saveDecision(m, { decision: 'revise', final_hpo_id: S.rev.term, revise_via: S.rev.via || (S.rev.step === 'cand' ? 'candidate' : 'search') }, function () { S.rev = null; }, true);
      return;
    case 'more': S.pages++; search('q', true); return;
    case 'amore': S.pages++; search('aq', true); return;
    case 'emore': S.pages++; search('eq', true); return;
    case 'reopen': S.rev = null; S.re = S.re ? null : { choice: null, text: '' }; renderRight(); return;
    case 'cancelre': S.re = null; renderRight(); return;
    case 'undore': saveDecision(m, { decision: d && d.decision ? d.decision : null, final_hpo_id: d && d.final_hpo_id, revise_via: d && d.revise_via, reassigned_to: null, action: 'reassign' }, function () { S.re = null; }); return;
    case 'savere': {
      var label = S.re.choice === 'other' ? ((matchPatient(S.re.text) || {}).label || S.re.text.trim()) : S.ptById[S.re.choice].label;
      if (label === S.ptById[m.pt].label) label = null; // back to the pipeline's patient
      saveDecision(m, { decision: d && d.decision ? d.decision : null, final_hpo_id: d && d.final_hpo_id, revise_via: d && d.revise_via, reassigned_to: label, action: 'reassign' }, function () { S.re = null; });
      return;
    }
    case 'clear':
      api('DELETE', '/api/articles/' + S.pmid + '/decision', { mention_id: m.id, client_at: nowIso() }).then(function () {
        if (d && d.reassigned_to) S.art.decisions[m.id] = { decision: null, final_hpo_id: null, revise_via: null, reassigned_to: d.reassigned_to };
        else delete S.art.decisions[m.id];
        S.rev = null; S.re = null; renderAll();
      }).catch(function (er) { toast(er.message); });
      return;
    case 'close': S.sel = null; S.selAdd = null; S.rev = null; S.re = null; S.edit = null; renderAll(); return;
    case 'prev': step(-1); return;
    case 'next': step(1); return;
    case 'toggleadd': S.add = S.add ? null : { loc: null, span: '', q: '', term: null, res: null, selErr: '' }; S.pages = 1; renderRight(); return;
    case 'usesel': useSelection(S.add); return;
    case 'eusesel': useSelection(S.edit); return;
    case 'canceladd': S.add = null; renderRight(); return;
    case 'saveadd': saveAdded(null, S.add, S.pt); return;
    case 'editadd': {
      if (S.edit) { S.edit = null; renderRight(); return; }
      var x = S.art.added.find(function (y) { return y.added_id === S.selAdd; });
      S.edit = { id: x.added_id, span: x.span_text, q: lab(x.hpo_id), term: x.hpo_id, res: null, selErr: '',
        loc: x.section_id && x.start_offset != null ? { sec: x.section_id, cell: x.cell_row != null ? [x.cell_row, x.cell_col] : null, start: x.start_offset, end: x.end_offset, text: x.span_text } : null };
      S.pages = 1; renderRight(); search('eq', true); return;
    }
    case 'canceledit': S.edit = null; renderRight(); return;
    case 'saveedit': { var x2 = S.art.added.find(function (y) { return y.added_id === S.edit.id; }); saveAdded(S.edit.id, S.edit, x2.patient_id); return; }
    case 'removeadd': {
      var xid = S.selAdd;
      api('DELETE', '/api/articles/' + S.pmid + '/added/' + xid).then(function () {
        S.art.added = S.art.added.filter(function (y) { return y.added_id !== xid; }); S.selAdd = null; S.edit = null; renderAll();
      }).catch(function (er) { toast(er.message); });
      return;
    }
  }
}
function saveAdded(id, f, pt) {
  if (!(f.loc && f.term)) return;
  api('POST', '/api/articles/' + S.pmid + '/added', { added_id: id, patient_id: pt, hpo_id: f.term, section_id: f.loc.sec, cell: f.loc.cell, start: f.loc.start, end: f.loc.end }).then(function (r) {
    addTerms(r.terms);
    var i = S.art.added.findIndex(function (x) { return x.added_id === r.added.added_id; });
    if (i >= 0) S.art.added[i] = r.added; else S.art.added.push(r.added);
    S.add = null; S.edit = null; S.lastLoc = null;
    if (window.getSelection) window.getSelection().removeAllRanges();
    openAdded(r.added.added_id, false);
  }).catch(function (er) { toast(er.message); });
}

// ------------------------------------------------------------------ page 6: review and submit
function renderReview(pmid) {
  S = null;
  Promise.all([api('GET', '/api/articles/' + pmid + '/review'), LIST ? Promise.resolve(LIST) : loadList()]).then(function (res) {
    var r = res[0], rows = r.rows;
    var n = function (k) { return rows.filter(function (x) { return x.decision === k; }).length; };
    var todo = rows.filter(function (x) { return x.decision === 'to_review'; });
    var DEC = { to_review: ['To review', 'b b-todo'], accept: ['Accepted', 'b b-acc'], revise: ['Revised', 'b b-rev'], no_code: ['No code', 'b b-nocode'], reject: ['Rejected', 'b b-rej'], added: ['Added', 'b b-add'] };
    var seg = function (k, color) { var c = n(k); return c ? '<span style="flex-grow:' + c + ';background:' + color + '"></span>' : ''; };
    var groups = [], by = {};
    rows.forEach(function (x) { if (!by[x.patient]) { by[x.patient] = []; groups.push(x.patient); } by[x.patient].push(x); });
    groups.forEach(function (g) { by[g].sort(function (a, b) { return (a.decision === 'to_review' ? 0 : 1) - (b.decision === 'to_review' ? 0 : 1); }); });
    var h = '<header style="height:60px;box-sizing:border-box;display:flex;align-items:center;gap:18px;padding:0 20px;background:#FFFFFF;border-bottom:1px solid #E6E4DF;flex-wrap:wrap">' +
      '<a href="#/a/' + pmid + '" style="display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#33383F;text-decoration:none;padding:8px 10px;border-radius:8px">' + BACK + 'Back to article</a>' +
      '<span aria-hidden="true" style="width:1px;height:24px;background:#E6E4DF"></span><span style="font-size:14px;color:#4A5059">' + posText(pmid) + ' · Review</span></header>' +
      '<main style="padding:36px 24px 72px;display:flex;justify-content:center"><div style="width:100%;max-width:1100px;display:flex;flex-direction:column;gap:24px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap"><div style="flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:8px"><h1 style="margin:0;font-family:\'Source Serif 4\',Georgia,serif;font-weight:600;font-size:28px;line-height:1.25">Check your answers before submitting</h1>' +
      '<p style="margin:0;font-size:15px;color:#4A5059">' + esc(r.article.title) + ' · <span class="mono">PMID ' + pmid + '</span></p></div>' +
      '<aside class="sumbox" aria-label="Summary of your answers"><div class="sb-head"><b>' + rows.length + '</b><span>phenotype mentions</span></div>' +
      '<div class="sb-bar" role="img">' + seg('accept', '#B9D19A') + seg('revise', '#E2BE7A') + seg('reject', '#D99A93') + seg('no_code', '#A3A9B0') + seg('added', '#BBA8E2') + seg('to_review', '#D3D7DC') + '</div>' +
      '<div class="sb-legend"><span><i style="background:#B9D19A"></i>Accepted<b>' + n('accept') + '</b></span><span><i style="background:#E2BE7A"></i>Revised<b>' + n('revise') + '</b></span><span><i style="background:#D99A93"></i>Rejected<b>' + n('reject') + '</b></span><span><i style="background:#A3A9B0"></i>No code<b>' + n('no_code') + '</b></span><span><i style="background:#BBA8E2"></i>Added<b>' + n('added') + '</b></span>' +
      (todo.length ? '<span><i style="background:#C3C8CE"></i>To review<b>' + todo.length + '</b></span>' : '') + '</div>' +
      '<div class="sb-foot"><span>Reassigned patient<b>' + rows.filter(function (x) { return x.reassigned; }).length + '</b></span></div></aside></div>';
    if (todo.length) h += '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px 12px 16px;border-radius:12px;background:#FBF1DE;border:1px solid #EED9AE;color:#6B4508;font-size:14px"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="#B07A1E" stroke-width="1.6"/><path d="M9 5v4.6" stroke="#B07A1E" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="12.6" r="1" fill="#B07A1E"/></svg>' +
      '<span style="flex:1;min-width:200px">' + todo.length + (todo.length === 1 ? ' mention still needs a decision.' : ' mentions still need a decision.') + '</span><a href="#/a/' + pmid + '?m=' + todo[0].item_id + '" style="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;background:#2B3036;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:13.5px">Go to the first one →</a></div>';
    if (r.submitted_at) h += '<div style="padding:12px 14px;border-radius:12px;background:#E3F2EA;color:#1F5E42;font-size:14px">Submitted on ' + esc(r.submitted_at.slice(0, 16).replace('T', ' ')) + ' UTC. Any change you make is still saved.</div>';
    groups.forEach(function (g) {
      var rs = by[g];
      h += '<section style="background:#FFFFFF;border:1px solid #E6E4DF;border-radius:12px;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:14px 18px;flex-wrap:wrap"><h2 style="margin:0;font-size:16px;font-weight:600">' + esc(g) + '</h2><span style="font-size:13px;color:#5F6670">' + rs.length + ' mentions</span></div>' +
        '<div style="overflow-x:auto"><table style="width:100%;min-width:900px;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#5F6670;font-size:12.5px;background:#FBFAF8"><th style="padding:8px 18px;font-weight:500;width:26%">Phenotype mention</th><th style="padding:8px 12px;font-weight:500;width:22%">Predicted term</th><th style="padding:8px 12px;font-weight:500;width:110px">Decision</th><th style="padding:8px 12px;font-weight:500">Final term</th><th style="padding:8px 12px;font-weight:500;width:160px">Patient</th><th style="padding:8px 18px;font-weight:500;width:60px"></th></tr></thead><tbody>' +
        rs.map(function (x) {
          var sup = x.decision === 'revise' || x.decision === 'no_code' || x.decision === 'reject';
          var pred = x.predicted_hpo_id ? '<span class="term' + (sup ? ' superseded' : '') + '"><span class="tl">' + esc(x.predicted_label || x.predicted_hpo_id) + '</span><span class="mono">' + x.predicted_hpo_id + '</span></span>' : '<span class="none">—</span>';
          var fin = x.final_hpo_id ? '<span class="term"><span class="tl">' + esc(x.final_label || x.final_hpo_id) + '</span><span class="mono">' + x.final_hpo_id + '</span></span>' : '<span class="none">—</span>';
          var pt = x.reassigned ? '<span class="retag">Reassigned to ' + esc(x.final_patient) + '</span>' : '<span class="pt">' + esc(x.final_patient) + '</span>';
          var edit = x.item_kind === 'predicted' ? '#/a/' + pmid + '?m=' + x.item_id : '#/a/' + pmid;
          return '<tr class="r' + (x.decision === 'reject' ? ' rej' : x.decision === 'to_review' ? ' todo' : '') + '"><td style="padding:12px 18px;font-family:\'Source Serif 4\',Georgia,serif;font-size:15px;line-height:1.4;color:#1F2328">“' + esc(x.mention) + '”</td><td style="padding:12px">' + pred + '</td><td style="padding:12px"><span class="' + DEC[x.decision][1] + '">' + DEC[x.decision][0] + '</span></td><td style="padding:12px">' + fin + '</td><td style="padding:12px">' + pt + '</td><td style="padding:12px 18px;text-align:right"><a class="edit" href="' + edit + '">Edit</a></td></tr>';
        }).join('') + '</tbody></table></div></section>';
    });
    h += '<section style="background:#FFFFFF;border:1px solid #E6E4DF;border-radius:12px;padding:20px 22px;display:flex;flex-direction:column;gap:10px"><label for="cm" style="font-size:15px;font-weight:600">Anything about this article overall? <span style="font-weight:400;color:#5F6670;font-size:14px">(optional)</span></label>' +
      '<textarea id="cm" rows="3" placeholder="e.g. patient boundaries were unclear in the discussion section" style="width:100%;box-sizing:border-box;border:1px solid #D5D2CB;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px">' + esc(r.comment || '') + '</textarea></section>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">' + (todo.length ? '<span style="font-size:13.5px;color:#8A5A0B;font-weight:500">Decide on all mentions to submit.</span>' : '<span style="font-size:13.5px;color:#5F6670">You can reopen this article until the study closes.</span>') +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><a href="#/a/' + pmid + '" style="display:inline-flex;align-items:center;height:46px;padding:0 18px;border-radius:10px;border:1px solid #D5D2CB;background:#FFFFFF;color:#33383F;text-decoration:none;font-weight:500;font-size:15px">Back to article</a>' +
      '<button type="button" id="sub" class="btn-dark' + (todo.length ? ' off' : '') + '" style="height:46px;padding:0 22px;font-size:15px">Submit and go to next article <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div></div></main>';
    app.innerHTML = h;
    document.getElementById('sub').onclick = function () {
      api('POST', '/api/articles/' + pmid + '/submit', { comment: document.getElementById('cm').value, client_at: nowIso() }).then(function () {
        return loadList();
      }).then(function (list) {
        var nx = list.find(function (x) { return !x.submitted_at; });
        location.hash = nx ? '#/a/' + nx.pmid : '#/';
      }).catch(function (e) { toast(e.message); });
    };
  }).catch(function (e) { if (e.message !== 'not signed in') toast(e.message); });
}

// Keyboard (not while typing in a field): ← / < previous mention in the text, → / > next mention to review,
// and Z / X / C for the card's options.
// the patient list closes on Escape or on a click anywhere outside it
document.addEventListener('mousedown', function (e) {
  if (S && S.ptMenu && !e.target.closest('.ptlist,.drum')) { S.ptMenu = false; renderRight(); }
});
var lastTyped = 0;
document.addEventListener('keydown', function (e) {
  var tg = (e.target.tagName || '').toLowerCase();
  if (tg === 'input' || tg === 'textarea') lastTyped = Date.now();
}, true);
document.addEventListener('keydown', function (e) {
  if (S && S.ptMenu && e.key === 'Escape') { S.ptMenu = false; renderRight(); var d = document.querySelector('#right .drum'); if (d) d.focus({ preventScroll: true }); return; }
  if (!S || e.altKey || e.ctrlKey || e.metaKey) return;
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  // no shortcuts while a form is open (Revise, Wrong patient?, Add or Revise a missed phenotype),
  // nor within a second of typing in a field: a key meant for a field must never make a decision
  if (S.rev || S.re || S.add || S.edit || Date.now() - lastTyped < 1000) return;
  // Z / X / C: the three options of the open card (Accept or Confirm, Revise, Reject)
  var k = (e.key || '').toLowerCase();
  if (S.sel && (k === 'z' || k === 'x' || k === 'c') && !e.shiftKey) {
    var btn = document.querySelector('#right .decs [data-key="' + k + '"]');
    if (btn) { e.preventDefault(); btn.click(); }
    return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.closest && e.target.closest('.drum')) { e.preventDefault(); drumGo(e.key === 'ArrowDown' ? 1 : -1); return; }
  if (e.target.id === 'split') return;
  var back = e.key === 'ArrowLeft' || e.key === '<' || e.key === ',';
  var fwd = e.key === 'ArrowRight' || e.key === '>' || e.key === '.';
  if (!back && !fwd) return;
  e.preventDefault();
  if (S.sel) { step(fwd ? 1 : -1); return; }
  var list = minePt(S.pt); if (!list.length) return;
  var n = fwd ? (list.find(function (m) { return status(m) === 'pending'; }) || list[0]) : list[list.length - 1];
  select(n.id, false);
});

route();
})();
