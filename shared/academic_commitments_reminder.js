/*
 * Teacher-dashboard reminder for pledges made at the academic / school-committee meeting.
 * Pledges are saved from Toacademichtml/academicreport.html (Whole School -> meeting brief) at
 * academicCommitments/{year}/{key} (school-scoped via SOMAP.P). Read-only here.
 *
 * Shows every active pledge of the signed-in teacher until 14 days after its deadline:
 * subjects/classes, baseline -> target, days left, and the consequence the teacher asked for.
 */
(function (global) {
  'use strict';
  const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dateSw = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Number(m[3]) + ' ' + MONTHS_SW[Number(m[2]) - 1] + ' ' + m[1] : iso; };
  const daysUntil = (iso) => {
    const p = String(iso || '').split('-').map(Number);
    if (p.length !== 3) return null;
    const end = new Date(p[0], p[1] - 1, p[2]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
  };
  function namesMatch(a, b) {
    const x = norm(a).split(' ').filter(Boolean);
    const y = norm(b).split(' ').filter(Boolean);
    if (!x.length || !y.length) return false;
    const shared = x.filter((t) => y.includes(t)).length;
    return shared >= Math.min(2, Math.min(x.length, y.length));
  }

  async function load() {
    const fb = global.firebase;
    if (!fb || !fb.apps || !fb.apps.length || !fb.database) return [];
    const db = fb.database();
    const years = new Set([String(new Date().getFullYear())]);
    try { const y = global.somapYearContext && global.somapYearContext.getSelectedYear && global.somapYearContext.getSelectedYear(); if (y) years.add(String(y)); } catch (_) {}
    const out = [];
    for (const year of years) {
      const path = 'academicCommitments/' + year;
      try {
        const snap = await db.ref(global.SOMAP && global.SOMAP.P ? global.SOMAP.P(path) : path).once('value');
        const val = (snap && snap.val && snap.val()) || {};
        Object.keys(val).forEach((k) => out.push({ key: k, ...val[k] }));
      } catch (_) {}
    }
    return out;
  }

  function mount(list) {
    if (!list.length) return;
    const host = document.createElement('div');
    host.id = 'academicCommitmentReminder';
    host.style.cssText = 'margin:14px auto;max-width:1200px;padding:0 12px;';
    host.innerHTML = list.map((c) => {
      const left = daysUntil(c.deadline);
      const overdue = left !== null && left < 0;
      const items = [(c.items || []).map((i) => esc(i.subject) + ' ' + esc(i.className) + ' (' + esc(i.baselinePct) + '%)').join(', '), c.classRole ? 'Darasa ' + esc(c.classRole.className) + ' (' + esc(c.classRole.baselinePct) + '%)' : ''].filter(Boolean).join(' &middot; ');
      return '<div style="border-radius:18px;padding:16px 18px;margin-bottom:10px;color:#fff;background:linear-gradient(135deg,' + (overdue ? '#7f1d1d,#b91c1c' : '#0f2a4a,#0f766e') + ');box-shadow:0 12px 28px rgba(15,23,42,.18)">'
        + '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center">'
        + '<div style="font-weight:700;font-size:15px">&#9888; Ahadi yako ya kikao cha taaluma (' + esc(dateSw(c.meetingDate)) + ')</div>'
        + '<div style="background:#bf902e;color:#0f2a4a;font-weight:800;border-radius:999px;padding:4px 12px;font-size:13px">'
        + (left === null ? '' : overdue ? 'Muda umeisha siku ' + Math.abs(left) + ' zilizopita' : (left === 0 ? 'Leo ndiyo siku ya mwisho' : 'Siku ' + left + ' zimebaki')) + '</div></div>'
        + '<div style="margin-top:8px;font-size:14px;line-height:1.5">Uliahidi kupandisha <b>' + items + '</b> hadi wastani wa <b>' + esc(c.targetPct) + '%</b> ifikapo <b>' + esc(dateSw(c.deadline)) + '</b>.</div>'
        + (c.consequence ? '<div style="margin-top:6px;font-size:13px;opacity:.9">Uliomba usipotimiza: <i>' + esc(c.consequence) + '</i></div>' : '')
        + '<div style="margin-top:6px;font-size:12px;opacity:.8">Fundisha kwa bidii, fuatilia kazi za wanafunzi kila siku, na wasilisha maendeleo kwa Mwalimu wa Taaluma.</div>'
        + '</div>';
    }).join('');
    const anchor = document.getElementById('setupSection');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
    else document.body.insertBefore(host, document.body.firstChild);
  }

  async function run() {
    // Wait for the dashboard to know who the teacher is (name loads asynchronously).
    let name = '';
    for (let i = 0; i < 40; i += 1) {
      const el = document.getElementById('teacherName');
      name = el && el.textContent && !/loading/i.test(el.textContent) ? el.textContent : '';
      if (name || (global.firebase && global.firebase.apps && global.firebase.apps.length && i > 10)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const workerId = String(localStorage.getItem('workerId') || sessionStorage.getItem('workerId') || '').trim();
    const storedName = localStorage.getItem('somap_workerName') || sessionStorage.getItem('somap_workerName') || '';
    const all = await load();
    const mine = all.filter((c) => c && c.status !== 'closed'
      && ((workerId && c.workerId && c.workerId === workerId) || namesMatch(c.teacher, name) || namesMatch(c.teacher, storedName)))
      .filter((c) => { const d = daysUntil(c.deadline); return d === null || d >= -14; })
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
    mount(mine);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { run().catch(() => {}); });
  else run().catch(() => {});
}(typeof window !== 'undefined' ? window : globalThis));
