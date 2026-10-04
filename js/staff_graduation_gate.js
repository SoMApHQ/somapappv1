/*
 * Graduation fee follow-up gate for staff.html.
 *
 * From 1 September to 30 November every year, each time a class teacher
 * opens staff.html they must first review the pupils in their class who have
 * not finished paying the graduation fee, and confirm they have read the list,
 * before they can use the dashboard. If everyone has paid, they are
 * congratulated instead.
 *
 * Figures follow js/graduation.js exactly:
 *   roster   schools/{schoolId}/graduation/{year}/students   (class for that year)
 *   payments schools/{schoolId}/graduation/{year}/payments   (approved payments)
 *   expected expectedOverride -> expectedFee -> class rate from graduation meta
 *   paid     sum of payments for the admission number, or status 'paid'
 *
 * Preview outside the season with staff.html?gradgate=force
 */
(function (window) {
  'use strict';

  const LOGO = 'images/somap-logo.png.jpg';
  const SEASON_START_MONTH = 8; // September (0-based)
  const SEASON_END_MONTH = 10;  // November (0-based), inclusive to 30 Nov

  const toStr = (v) => (v == null ? '' : String(v));
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const sanitizeKey = (raw) => toStr(raw).replace(/[.#$/[\]]/g, '_');
  const esc = (v) => toStr(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `TSh ${Math.round(toNum(n)).toLocaleString('en-US')}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (d) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  function inSeason(now = new Date()) {
    try {
      if (new URLSearchParams(window.location.search).get('gradgate') === 'force') return true;
    } catch (_) { /* ignore */ }
    const m = now.getMonth();
    return m >= SEASON_START_MONTH && m <= SEASON_END_MONTH;
  }

  // Same rules as normalizeClassName() in js/graduation.js
  function normalizeClass(className) {
    const cls = toStr(className).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (!cls) return '';
    if (cls.includes('baby')) return 'Baby Class';
    if (cls.includes('middle')) return 'Middle Class';
    if (cls.includes('pre unit') || cls.includes('preunit') || cls.includes('preparatory')) return 'Pre Unit Class';
    const match = cls.match(/\b(class|grade|std|standard)\s*([1-7])\b/) || cls.match(/\b([1-7])\b/);
    if (match) return `Class ${match[2] || match[1]}`;
    return toStr(className).trim();
  }

  function expectedForClass(className, meta) {
    const high = toNum(meta?.feePreunitAnd7 || 45000);
    const low = toNum(meta?.feeOthers || 10000);
    const cls = toStr(className).toLowerCase();
    if (!cls) return low;
    const graduandTokens = ['preunit', 'pre-unit', 'pre unit', 'preparatory', 'class 7', 'std 7', 'grade 7'];
    return graduandTokens.some((t) => cls.includes(t)) ? high : low;
  }

  function gradSchoolId(explicit) {
    const raw = toStr(explicit || window.SOMAP?.getSchool?.()?.id || window.currentSchoolId || 'socrates-school').trim();
    return !raw || raw === 'socrates' ? 'socrates-school' : raw;
  }

  function paymentTotals(payments, year) {
    const totals = {};
    Object.values(payments || {}).forEach((p) => {
      const explicitYear = Number(p?.year || p?.academicYear || p?.graduationYear || p?.modulePayload?.year);
      if (Number.isFinite(explicitYear) && explicitYear > 1900 && explicitYear !== Number(year)) return;
      const adm = sanitizeKey(p?.admissionNo || p?.admission || p?.admNo || p?.studentAdm);
      if (!adm) return;
      totals[adm] = toNum(totals[adm]) + toNum(p?.amount);
    });
    return totals;
  }

  function isGhost(s) {
    const name = toStr(s.name || s.fullName).trim();
    const cls = toStr(s.class || s.className).trim();
    const adm = toStr(s.admissionNo || s.admissionNumber || s.id).trim();
    return !adm || !name || name.toLowerCase() === 'student' || !cls || cls === '--' || cls === '-';
  }

  async function waitFor(getter, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value && value.length) return value;
      await new Promise((r) => setTimeout(r, 300));
    }
    return getter() || [];
  }

  async function loadClassReport(opts) {
    const db = opts.db || window.firebase.database();
    const year = opts.year || new Date().getFullYear();
    const base = `schools/${gradSchoolId(opts.schoolId)}/graduation/${year}`;
    const [studentsSnap, paymentsSnap, metaSnap] = await Promise.all([
      db.ref(`${base}/students`).once('value'),
      db.ref(`${base}/payments`).once('value'),
      db.ref(`${base}/meta`).once('value'),
    ]);
    const meta = metaSnap.val() || {};
    const totals = paymentTotals(paymentsSnap.val(), year);
    const wanted = normalizeClass(opts.className).toLowerCase();
    const cutoff = new Date(meta.debtCutoffISO || `${year}-11-07`);

    let source = 'graduation';
    let pupils = Object.entries(studentsSnap.val() || {})
      .map(([key, s]) => ({ key, ...(s || {}) }))
      .filter((s) => s.inactive !== true && !isGhost(s))
      .filter((s) => normalizeClass(s.class || s.classLevel || s.className).toLowerCase() === wanted)
      .map((s) => {
        const adm = sanitizeKey(s.admissionNo || s.admissionNumber || s.key);
        let expected = expectedForClass(s.class, meta);
        if (s.expectedOverride != null) expected = toNum(s.expectedOverride);
        else if (s.expectedFee != null) expected = toNum(s.expectedFee);
        return {
          adm: s.admissionNo || s.admissionNumber || s.key,
          name: toStr(s.name || s.fullName).trim(),
          className: normalizeClass(s.class) || opts.className,
          parentName: toStr(s.parentName).trim(),
          phone: toStr(s.parentPhone).trim(),
          expected,
          paid: Math.max(0, toNum(totals[adm])),
          manualPaid: toStr(s.status).toLowerCase() === 'paid',
        };
      });

    // Graduation roster not prepared for this class yet: use the class
    // register already loaded on staff.html.
    if (!pupils.length && typeof opts.fallbackStudents === 'function') {
      const list = await waitFor(opts.fallbackStudents, 8000);
      if (list.length) {
        source = 'register';
        pupils = list.map((s) => {
          const adm = sanitizeKey(s.adm || s.id);
          return {
            adm: s.adm || s.id,
            name: toStr(s.name).trim(),
            className: opts.className,
            parentName: toStr(s.parent).trim(),
            phone: toStr(s.contact).trim(),
            expected: expectedForClass(opts.className, meta),
            paid: Math.max(0, toNum(totals[adm])),
            manualPaid: false,
          };
        });
      }
    }

    const now = new Date();
    pupils.forEach((p) => {
      p.balance = Math.max(0, p.expected - p.paid);
      if (p.expected <= 0 || p.paid >= p.expected || p.manualPaid) { p.status = 'paid'; p.balance = 0; }
      else if (now > cutoff) p.status = 'debt';
      else if (p.paid > 0) p.status = 'partial';
      else p.status = 'unpaid';
    });
    pupils.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

    const unpaid = pupils.filter((p) => p.status !== 'paid');
    const expectedTotal = pupils.reduce((s, p) => s + p.expected, 0);
    const collected = pupils.reduce((s, p) => s + Math.min(p.paid, p.expected || p.paid), 0);
    return {
      year,
      className: opts.className,
      source,
      cutoff,
      pupils,
      unpaid,
      paidCount: pupils.length - unpaid.length,
      partialCount: unpaid.filter((p) => p.paid > 0).length,
      zeroCount: unpaid.filter((p) => p.paid <= 0).length,
      expectedTotal,
      collected,
      balance: unpaid.reduce((s, p) => s + p.balance, 0),
      feeForClass: expectedForClass(opts.className, meta),
    };
  }

  // ---------------------------------------------------------------- UI
  const CSS = `
  .sgg-overlay{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(900px 500px at 10% 0%,rgba(99,102,241,.35),transparent 60%),rgba(15,23,42,.88);backdrop-filter:blur(6px);overflow-y:auto;padding:24px 16px;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a}
  .sgg-card{max-width:1080px;margin:0 auto;background:#fff;border-radius:24px;box-shadow:0 40px 80px -30px rgba(0,0,0,.6);overflow:hidden}
  .sgg-head{display:flex;align-items:center;gap:16px;padding:22px 26px;background:linear-gradient(120deg,#312e81,#4338ca 55%,#7c3aed);color:#fff;flex-wrap:wrap}
  .sgg-head img{width:56px;height:56px;border-radius:16px;background:#fff;padding:4px;object-fit:contain}
  .sgg-head h2{font-size:1.35rem;font-weight:800;margin:0;letter-spacing:-.01em}
  .sgg-head p{margin:2px 0 0;color:#c7d2fe;font-size:.85rem}
  .sgg-head .sgg-date{margin-left:auto;text-align:right;font-size:.8rem;color:#e0e7ff}
  .sgg-body{padding:24px 26px}
  .sgg-intro{text-align:center;padding:34px 26px 30px}
  .sgg-intro .sgg-big{width:84px;height:84px;margin:0 auto 14px;border-radius:24px;display:grid;place-items:center;font-size:2.1rem;background:linear-gradient(135deg,#fef3c7,#fde68a);color:#b45309}
  .sgg-intro h3{font-size:1.4rem;font-weight:800;margin:0 0 8px}
  .sgg-intro p{color:#475569;max-width:620px;margin:0 auto 6px;line-height:1.55}
  .sgg-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:13px 22px;border-radius:14px;border:0;font-weight:800;font-size:.95rem;cursor:pointer;transition:transform .15s,box-shadow .15s,opacity .15s}
  .sgg-btn:hover{transform:translateY(-1px)}
  .sgg-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
  .sgg-primary{background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;box-shadow:0 16px 30px -14px rgba(79,70,229,.7)}
  .sgg-success{background:linear-gradient(135deg,#059669,#10b981);color:#fff;box-shadow:0 16px 30px -14px rgba(5,150,105,.7)}
  .sgg-ghost{background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1}
  .sgg-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
  .sgg-stat{border-radius:16px;padding:14px 16px;position:relative;overflow:hidden}
  .sgg-stat .l{font-size:.68rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.8}
  .sgg-stat .v{font-size:1.7rem;font-weight:800;margin-top:4px;line-height:1.1}
  .sgg-stat .s{font-size:.75rem;margin-top:3px;opacity:.85}
  .sgg-blue{background:#eef2ff;color:#3730a3}.sgg-green{background:#ecfdf5;color:#047857}.sgg-red{background:#fff1f2;color:#be123c}.sgg-amber{background:#fffbeb;color:#b45309}
  .sgg-progress{height:12px;border-radius:999px;background:#fee2e2;overflow:hidden;margin:4px 0 6px}
  .sgg-progress>div{height:100%;background:linear-gradient(90deg,#10b981,#059669);border-radius:999px}
  .sgg-meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:.8rem;color:#475569;margin-bottom:18px}
  .sgg-note{border-radius:12px;padding:10px 14px;font-size:.82rem;background:#fffbeb;border:1px solid #fde68a;color:#92400e;margin-bottom:14px}
  .sgg-tablewrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:16px}
  .sgg-table{width:100%;border-collapse:collapse;font-size:.86rem}
  .sgg-table th{background:#f8fafc;text-align:left;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#475569;padding:11px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
  .sgg-table td{padding:11px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
  .sgg-table tr:nth-child(even) td{background:#fcfcfd}
  .sgg-table .num{text-align:right;white-space:nowrap}
  .sgg-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
  .sgg-pill.unpaid{background:#ffe4e6;color:#be123c}.sgg-pill.partial{background:#fef3c7;color:#b45309}.sgg-pill.debt{background:#7f1d1d;color:#fff}
  .sgg-call{display:inline-flex;align-items:center;gap:6px;color:#1d4ed8;font-weight:700;text-decoration:none;white-space:nowrap}
  .sgg-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;padding:18px 26px;border-top:1px solid #e2e8f0;background:#f8fafc}
  .sgg-check{display:flex;align-items:flex-start;gap:10px;font-size:.88rem;font-weight:600;color:#0f172a;cursor:pointer;max-width:520px}
  .sgg-check input{width:20px;height:20px;margin-top:1px;accent-color:#059669;flex-shrink:0}
  .sgg-congrats{text-align:center;padding:40px 26px 34px}
  .sgg-congrats .sgg-big{width:96px;height:96px;margin:0 auto 14px;border-radius:999px;display:grid;place-items:center;font-size:2.6rem;background:linear-gradient(135deg,#d1fae5,#6ee7b7);color:#047857}
  .sgg-congrats h3{font-size:1.6rem;font-weight:800;margin:0 0 8px;color:#065f46}
  .sgg-congrats p{color:#475569;max-width:560px;margin:0 auto 18px;line-height:1.55}
  .sgg-spin{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sggspin .8s linear infinite}
  @keyframes sggspin{to{transform:rotate(360deg)}}
  @media (max-width:640px){.sgg-head .sgg-date{margin-left:0;text-align:left}.sgg-body,.sgg-foot{padding:16px}}
  `;

  function injectCss() {
    if (document.getElementById('sgg-style')) return;
    const style = document.createElement('style');
    style.id = 'sgg-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function header(ctx) {
    return `
      <div class="sgg-head">
        <img src="${LOGO}" alt="SoMAp">
        <div>
          <h2>Graduation Fee Follow-up</h2>
          <p>${esc(ctx.schoolName)} &middot; ${esc(ctx.className)} &middot; Graduation ${esc(ctx.year)}</p>
        </div>
        <div class="sgg-date">${esc(fmtDate(new Date()))}<br>Teacher: ${esc(ctx.teacherName)}</div>
      </div>`;
  }

  function renderIntro(root, ctx, onOpen) {
    root.innerHTML = `
      <div class="sgg-card">
        ${header(ctx)}
        <div class="sgg-intro">
          <div class="sgg-big"><i class="fas fa-graduation-cap"></i></div>
          <h3>Confirm this list as your class list that has not paid graduation fees</h3>
          <p>Graduation preparation runs from 1 September to 30 November. Before you continue to your dashboard, please review the pupils in <b>${esc(ctx.className)}</b> who have not finished paying the graduation fee, so you can follow up with their parents.</p>
          <p style="font-size:.82rem;color:#64748b">This list appears every time you open the Teacher Command Center during the graduation season.</p>
          <div style="margin-top:22px">
            <button type="button" class="sgg-btn sgg-primary" data-act="open"><i class="fas fa-list-check"></i> View my class graduation list</button>
          </div>
        </div>
      </div>`;
    root.querySelector('[data-act="open"]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="sgg-spin"></span> Loading your class list&hellip;';
      onOpen();
    });
  }

  const settledPct = (r) => (r.expectedTotal ? Math.round(((r.expectedTotal - r.balance) * 100) / r.expectedTotal) : 0);

  function statsHtml(r) {
    const pct = settledPct(r);
    return `
      <div class="sgg-stats">
        <div class="sgg-stat sgg-blue"><div class="l">Pupils in your class</div><div class="v">${r.pupils.length}</div><div class="s">Fee per pupil ${esc(money(r.feeForClass))}</div></div>
        <div class="sgg-stat sgg-green"><div class="l">Paid in full</div><div class="v">${r.paidCount}</div><div class="s">${r.pupils.length ? Math.round((r.paidCount * 100) / r.pupils.length) : 0}% of the class</div></div>
        <div class="sgg-stat sgg-red"><div class="l">Not yet paid</div><div class="v">${r.unpaid.length}</div><div class="s">${r.zeroCount} paid nothing &middot; ${r.partialCount} part-paid</div></div>
        <div class="sgg-stat sgg-amber"><div class="l">Balance to collect</div><div class="v" style="font-size:1.35rem">${esc(money(r.balance))}</div><div class="s">Collected ${esc(money(r.collected))} of ${esc(money(r.expectedTotal))}</div></div>
      </div>
      <div class="sgg-progress"><div style="width:${pct}%"></div></div>
      <div class="sgg-meta">
        <span><b>${pct}%</b> of your class graduation fees settled</span>
        <span>Payment deadline: <b>${esc(fmtDate(r.cutoff))}</b>${r.cutoff > new Date() ? ` &middot; ${Math.ceil((r.cutoff - new Date()) / 86400000)} days left` : ' &middot; <b style="color:#be123c">deadline passed</b>'}</span>
      </div>`;
  }

  function tableHtml(r) {
    const rows = r.unpaid.map((p, i) => {
      const phoneDigits = p.phone.replace(/[^\d+]/g, '');
      const call = p.phone ? `<a class="sgg-call" href="tel:${esc(phoneDigits)}"><i class="fas fa-phone"></i>${esc(p.phone)}</a>` : '<span style="color:#94a3b8">No contact</span>';
      const label = p.status === 'debt' ? 'Debt' : p.status === 'partial' ? 'Part-paid' : 'Not paid';
      return `<tr>
        <td style="color:#94a3b8">${i + 1}</td>
        <td><b>${esc(p.name)}</b><div style="font-size:.72rem;color:#64748b">${esc(p.adm)}</div></td>
        <td>${esc(p.className)}</td>
        <td class="num">${esc(money(p.expected))}</td>
        <td class="num" style="color:#047857">${esc(money(p.paid))}</td>
        <td class="num" style="color:#be123c;font-weight:800">${esc(money(p.balance))}</td>
        <td><span class="sgg-pill ${p.status}">${label}</span></td>
        <td>${esc(p.parentName || '--')}</td>
        <td>${call}</td>
      </tr>`;
    }).join('');
    return `
      <div class="sgg-tablewrap">
        <table class="sgg-table">
          <thead><tr><th>#</th><th>Pupil</th><th>Class</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th>Parent</th><th>Parent contact</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderList(root, ctx, report, onConfirm) {
    const sourceNote = report.source === 'register'
      ? `<div class="sgg-note"><i class="fas fa-circle-info"></i> The office has not prepared the ${esc(report.year)} graduation register for your class yet, so this list uses your class register and the standard fee of ${esc(money(report.feeForClass))}.</div>`
      : '';
    root.innerHTML = `
      <div class="sgg-card">
        ${header(ctx)}
        <div class="sgg-body">
          ${statsHtml(report)}
          ${sourceNote}
          <h3 style="font-size:1.05rem;font-weight:800;margin:0 0 10px"><i class="fas fa-user-clock" style="color:#e11d48"></i> Pupils who have not finished paying (${report.unpaid.length})</h3>
          ${tableHtml(report)}
        </div>
        <div class="sgg-foot">
          <label class="sgg-check"><input type="checkbox" data-act="ack"> I have read this list and I will follow up with these parents about the graduation fee.</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button type="button" class="sgg-btn sgg-ghost" data-act="pdf"><i class="fas fa-file-pdf" style="color:#e11d48"></i> Download PDF</button>
            <button type="button" class="sgg-btn sgg-success" data-act="confirm" disabled><i class="fas fa-check"></i> Confirm &amp; continue</button>
          </div>
        </div>
      </div>`;
    const ack = root.querySelector('[data-act="ack"]');
    const confirmBtn = root.querySelector('[data-act="confirm"]');
    const pdfBtn = root.querySelector('[data-act="pdf"]');
    let downloaded = false;
    ack.addEventListener('change', () => { confirmBtn.disabled = !ack.checked; });
    pdfBtn.addEventListener('click', async () => {
      const original = pdfBtn.innerHTML;
      pdfBtn.disabled = true;
      pdfBtn.innerHTML = '<span class="sgg-spin" style="border-color:rgba(15,23,42,.2);border-top-color:#0f172a"></span> Preparing&hellip;';
      try {
        await downloadPdf(ctx, report);
        downloaded = true;
      } catch (err) {
        console.error('Graduation follow-up PDF failed', err);
        alert('Could not create the PDF. Please check your connection and try again.');
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = original;
      }
    });
    confirmBtn.addEventListener('click', () => onConfirm({ downloaded }));
  }

  function renderCongrats(root, ctx, report, onContinue) {
    root.innerHTML = `
      <div class="sgg-card">
        ${header(ctx)}
        <div class="sgg-congrats">
          <div class="sgg-big"><i class="fas fa-trophy"></i></div>
          <h3>Congratulations, ${esc(ctx.teacherName)}!</h3>
          <p>All <b>${report.pupils.length}</b> pupils in <b>${esc(ctx.className)}</b> have paid the ${esc(report.year)} graduation fee in full (${esc(money(report.collected))}). Thank you for your hard work following up with parents.</p>
          <button type="button" class="sgg-btn sgg-success" data-act="continue"><i class="fas fa-arrow-right"></i> Continue to my dashboard</button>
        </div>
      </div>`;
    root.querySelector('[data-act="continue"]').addEventListener('click', onContinue);
  }

  function renderError(root, ctx, message, onContinue) {
    root.innerHTML = `
      <div class="sgg-card">
        ${header(ctx)}
        <div class="sgg-congrats">
          <div class="sgg-big" style="background:#fee2e2;color:#be123c"><i class="fas fa-triangle-exclamation"></i></div>
          <h3 style="color:#9f1239">Graduation list could not load</h3>
          <p>${esc(message)} It will be shown again the next time you open the dashboard.</p>
          <button type="button" class="sgg-btn sgg-ghost" data-act="continue">Continue to my dashboard</button>
        </div>
      </div>`;
    root.querySelector('[data-act="continue"]').addEventListener('click', onContinue);
  }

  // ---------------------------------------------------------------- PDF
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function ensureJsPdf() {
    if (!window.jspdf?.jsPDF) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    if (!window.jspdf?.jsPDF?.API?.autoTable) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.0/jspdf.plugin.autotable.min.js');
    return window.jspdf.jsPDF;
  }

  function logoDataUrl() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = LOGO;
    });
  }

  async function downloadPdf(ctx, r) {
    const jsPDF = await ensureJsPdf();
    const logo = await logoDataUrl();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 12;
    const CW = W - 2 * M;
    const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
    const ink = (c) => doc.setTextColor(c[0], c[1], c[2]);
    const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
    const C = {
      indigo: [67, 56, 202], indigoDark: [49, 46, 129], indigoSoft: [199, 210, 254], indigoLight: [238, 242, 255],
      green: [4, 120, 87], greenLight: [236, 253, 245], red: [190, 18, 60], redLight: [255, 241, 242],
      amber: [180, 83, 9], amberLight: [255, 251, 235], slate: [71, 85, 105], slate400: [148, 163, 184], slate200: [226, 232, 240], white: [255, 255, 255], ink: [15, 23, 42]
    };

    // Header band
    fill(C.indigo); doc.rect(0, 0, W, 30, 'F');
    fill(C.indigoDark); doc.rect(0, 30, W, 1.2, 'F');
    let tx = M;
    if (logo) {
      fill(C.white); doc.roundedRect(M, 5, 20, 20, 3, 3, 'F');
      try { doc.addImage(logo, 'PNG', M + 1.5, 6.5, 17, 17); } catch (_) { /* ignore */ }
      tx = M + 25;
    }
    font('bold', 16); ink(C.white);
    doc.text('Graduation Fee Follow-up', tx, 13);
    font('normal', 10);
    doc.text(`${ctx.schoolName}  |  ${ctx.className}  |  Graduation ${r.year}`, tx, 19.5);
    font('normal', 8); ink(C.indigoSoft);
    doc.text(`Teacher: ${ctx.teacherName}`, tx, 25);
    font('bold', 10); ink(C.white);
    doc.text(`Printed ${fmtDate(new Date())}`, W - M, 13, { align: 'right' });
    font('normal', 8.5); ink(C.indigoSoft);
    doc.text(`Payment deadline: ${fmtDate(r.cutoff)}`, W - M, 19.5, { align: 'right' });

    // Summary cards
    const pct = settledPct(r);
    const cards = [
      ['PUPILS IN CLASS', String(r.pupils.length), `Fee per pupil ${money(r.feeForClass)}`, C.indigo, C.indigoLight],
      ['PAID IN FULL', String(r.paidCount), `${r.pupils.length ? Math.round((r.paidCount * 100) / r.pupils.length) : 0}% of the class`, C.green, C.greenLight],
      ['NOT YET PAID', String(r.unpaid.length), `${r.zeroCount} paid nothing, ${r.partialCount} part-paid`, C.red, C.redLight],
      ['BALANCE TO COLLECT', money(r.balance), `Collected ${money(r.collected)} (${pct}%)`, C.amber, C.amberLight],
    ];
    let y = 37;
    const gap = 4;
    const cw = (CW - gap * 3) / 4;
    cards.forEach(([label, value, sub, color, tint], i) => {
      const x = M + i * (cw + gap);
      fill(tint); doc.roundedRect(x, y, cw, 22, 2.5, 2.5, 'F');
      fill(color); doc.rect(x, y + 3, 1.5, 16, 'F');
      font('bold', 7); ink(C.slate); doc.text(label, x + 5, y + 6);
      font('bold', value.length > 10 ? 13 : 17); ink(color); doc.text(value, x + 5, y + 14.5);
      font('normal', 7.5); ink(C.slate); doc.text(sub, x + 5, y + 19.5);
    });
    y += 27;

    // Progress bar
    font('bold', 8.5); ink(C.ink); doc.text('Settled', M, y + 3.6);
    fill(C.redLight); doc.rect(M + 20, y, CW - 20, 5, 'F');
    fill(C.green); doc.rect(M + 20, y, ((CW - 20) * pct) / 100, 5, 'F');
    font('bold', 7.5); ink(pct > 12 ? C.white : C.ink);
    doc.text(`${pct}%`, M + 22, y + 3.6);
    y += 11;

    font('bold', 11); ink(C.ink);
    doc.text(`Pupils who have not finished paying (${r.unpaid.length})`, M, y);
    y += 3;

    const statusColor = { unpaid: C.red, partial: C.amber, debt: C.red };
    doc.autoTable({
      startY: y,
      theme: 'grid',
      margin: { left: M, right: M, top: 14, bottom: 16 },
      head: [['#', 'Pupil', 'Adm. no.', 'Fee', 'Paid', 'Balance', 'Status', 'Parent', 'Parent contact', 'Follow-up notes']],
      body: r.unpaid.map((p, i) => [
        String(i + 1), p.name, toStr(p.adm), money(p.expected), money(p.paid), money(p.balance),
        p.status === 'debt' ? 'DEBT' : p.status === 'partial' ? 'PART-PAID' : 'NOT PAID',
        p.parentName || '-', p.phone || '-', ''
      ]),
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, textColor: C.ink, lineColor: C.slate200, lineWidth: 0.15, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: C.indigo, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center', textColor: C.slate400 },
        1: { cellWidth: 52, fontStyle: 'bold' },
        2: { cellWidth: 34 },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 22, halign: 'right', textColor: C.green },
        5: { cellWidth: 23, halign: 'right', fontStyle: 'bold', textColor: C.red },
        6: { cellWidth: 21, fontStyle: 'bold' },
        7: { cellWidth: 30 },
        8: { cellWidth: 28, fontStyle: 'bold' },
        9: { cellWidth: 'auto' }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const p = r.unpaid[data.row.index];
          if (p) data.cell.styles.textColor = statusColor[p.status] || C.red;
        }
      },
    });

    let endY = doc.lastAutoTable.finalY + 16;
    if (endY + 10 > H - 16) { doc.addPage(); endY = 30; }
    const sw = CW / 3;
    ['Class teacher (name & signature)', 'Date', 'Head teacher / Accountant'].forEach((label, i) => {
      const x = M + i * sw;
      doc.setDrawColor(C.slate400[0], C.slate400[1], C.slate400[2]);
      doc.setLineWidth(0.3);
      doc.line(x, endY, x + sw - 14, endY);
      font('normal', 8); ink(C.slate); doc.text(label, x, endY + 5);
    });

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
      doc.setPage(p);
      doc.setDrawColor(C.slate200[0], C.slate200[1], C.slate200[2]);
      doc.line(M, H - 10, W - M, H - 10);
      font('normal', 7.5); ink(C.slate400);
      doc.text(`SoMAp  |  ${ctx.schoolName}  |  ${ctx.className} graduation fee follow-up ${r.year}`, M, H - 6);
      doc.text(`Page ${p} of ${pages}`, W - M, H - 6, { align: 'right' });
    }

    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    doc.save(`Graduation_followup_${toStr(ctx.className).replace(/[^A-Za-z0-9]+/g, '_')}_${stamp}.pdf`);
  }

  // ---------------------------------------------------------------- flow
  async function logAcknowledgement(opts, report, extra) {
    try {
      const db = opts.db || window.firebase.database();
      const key = toStr(opts.email).trim().toLowerCase().replace(/[.#$/[\]]/g, '_') || 'unknown';
      await db.ref(`schools/${gradSchoolId(opts.schoolId)}/graduation/${report.year}/teacherAcknowledgements/${key}`).push({
        at: Date.now(),
        className: opts.className,
        pupils: report.pupils.length,
        unpaid: report.unpaid.length,
        balance: report.balance,
        downloaded: !!extra?.downloaded,
        allPaid: report.unpaid.length === 0,
      });
    } catch (err) {
      console.warn('Graduation acknowledgement log failed', err?.message || err);
    }
  }

  let doneThisPageLoad = false;

  function run(opts = {}) {
    if (!opts.className || !inSeason()) return Promise.resolve(false);
    // Shown on every visit; but only once per page load, even if the sign-in
    // callback fires again while the teacher is working.
    if (doneThisPageLoad || document.getElementById('sgg-overlay')) return Promise.resolve(true);
    injectCss();
    const ctx = {
      className: normalizeClass(opts.className) || opts.className,
      teacherName: toStr(opts.teacherName || 'Teacher'),
      schoolName: toStr(opts.schoolName || window.SOMAP?.getSchool?.()?.name || 'Socrates School'),
      year: opts.year || new Date().getFullYear(),
    };
    const overlay = document.createElement('div');
    overlay.id = 'sgg-overlay';
    overlay.className = 'sgg-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return new Promise((resolve) => {
      const close = () => {
        doneThisPageLoad = true;
        overlay.remove();
        document.body.style.overflow = previousOverflow;
        resolve(true);
      };
      // Start loading in the background so the list is ready when asked for.
      const reportPromise = loadClassReport({ ...opts, className: ctx.className, year: ctx.year });
      renderIntro(overlay, ctx, async () => {
        let report;
        try {
          report = await reportPromise;
        } catch (err) {
          console.error('Graduation gate load failed', err);
          renderError(overlay, ctx, 'There was a problem reading graduation payments.', close);
          return;
        }
        if (!report.pupils.length) {
          renderError(overlay, ctx, `No pupils were found for ${ctx.className} in the ${ctx.year} graduation register.`, close);
          return;
        }
        overlay.scrollTop = 0;
        if (!report.unpaid.length) {
          renderCongrats(overlay, ctx, report, () => { logAcknowledgement(opts, report); close(); });
        } else {
          renderList(overlay, ctx, report, (extra) => { logAcknowledgement(opts, report, extra); close(); });
        }
      });
    });
  }

  window.SomapGraduationGate = { run, loadClassReport, inSeason };
})(window);
