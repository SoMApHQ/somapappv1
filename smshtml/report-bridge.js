/*
 * SoMAp Matokeo — READ-ONLY bridge into Toacademichtml/generatereportform.html.
 *
 * Mawasiliano opens the real report page in a hidden frame (same site) and adds
 * this script to it. The bridge:
 *  - sets year / class / exam / month EXACTLY as the page's own dropdowns do
 *    (see its attachListeners) and runs the page's own loadAllData();
 *  - makes each child's report card with the page's OWN drawReportCard() on the
 *    same A4 jsPDF document its "Download PDF" button uses, and returns the bytes
 *    (instead of saving them) — so the parent's link is the identical PDF;
 *  - reads the printed "Student Avg" and "position/N" with the same helpers and
 *    the same steps drawReportCard uses, for the SMS text.
 * Nothing is re-designed, re-calculated differently, or written.
 * If the report page changes and a needed piece is missing, the bridge refuses.
 */
(function () {
  'use strict';
  if (window.SomapReportBridge) return;

  function missingPieces() {
    const missing = [];
    if (typeof state !== 'object' || !state) missing.push('state');
    if (typeof RUNTIME !== 'object' || !RUNTIME) missing.push('RUNTIME');
    [['loadAllData', typeof loadAllData], ['getAllExamOptions', typeof getAllExamOptions], ['getExamKeyFromLabel', typeof getExamKeyFromLabel],
      ['normalizeDisplayClass', typeof normalizeDisplayClass], ['preferredMonthStorage', typeof preferredMonthStorage],
      ['subjectListForClass', typeof subjectListForClass], ['classAveragePct', typeof classAveragePct], ['gradeFromPercent', typeof gradeFromPercent],
      ['drawReportCard', typeof drawReportCard], ['ensurePdfLibsLoaded', typeof ensurePdfLibsLoaded],
      ['toNormalizedRows', typeof toNormalizedRows], ['studentPercentFrom', typeof studentPercentFrom], ['isNumber', typeof isNumber],
    ].forEach(([name, t]) => { if (t !== 'function') missing.push(name); });
    return missing;
  }
  function check() {
    const m = missingPieces();
    if (m.length) throw new Error('Ukurasa wa ripoti umebadilika (haupo: ' + m.join(', ') + '). Matokeo yamesimamishwa ili kuepuka ripoti tofauti.');
  }

  // Inside the hidden frame, pop-ups would never be seen: capture them as errors instead.
  let lastError = null;
  if (window.Swal && typeof window.Swal.fire === 'function') {
    window.Swal.fire = function (title, text, icon) {
      const t = typeof title === 'object' && title ? [title.title, title.text].filter(Boolean).join(': ') : [title, text].filter(Boolean).join(': ');
      const isError = (typeof title === 'object' && title && title.icon === 'error') || icon === 'error';
      if (isError) lastError = t || 'Hitilafu ya ukurasa wa ripoti';
      return Promise.resolve({ isConfirmed: false, isDismissed: true });
    };
  }

  // Wait until the page finished booting and its idle-time setup (exam list) ran.
  const ready = new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      try {
        check();
        if (typeof reportBooted !== 'undefined' && reportBooted && Date.now() - started > 2500) return resolve(true);
      } catch (err) {
        if (Date.now() - started > 4000) return reject(err);
      }
      if (Date.now() - started > 60000) return reject(new Error('Ukurasa wa ripoti haukupakia kwa wakati.'));
      setTimeout(poll, 250);
    })();
  });

  // The printed figures, with the same helpers and steps as drawReportCard().
  function cardFigures(s) {
    const cohortSize = state.students.length || state.filtered.length || 0;
    const posLabel = (s.overallPosition && s.overallPosition !== '-') ? `${s.overallPosition}/${cohortSize}` : `-/${cohortSize}`;
    const normalizedSubjects = toNormalizedRows(s.subjectStats.subjects);
    const overall = studentPercentFrom(s.subjectStats.subjects);
    const rows = normalizedSubjects.filter((e) => e.attempted);
    const dispScore = rows.reduce((sum, e) => sum + e.dispScore, 0);
    const dispMax = rows.reduce((sum, e) => sum + e.dispMax, 0);
    const dispPct = dispMax > 0 ? (dispScore * 100) / dispMax : overall.pct;
    const annualOverride = (state.examKey === 'annual' && isNumber(s.annualPct)) ? s.annualPct : null;
    const overallPct = annualOverride !== null ? annualOverride : dispPct;
    return { avgText: `${overallPct.toFixed(1)}%`, posLabel, cohortSize };
  }

  let current = null; // { className, examLabel, year, month } of the computed state

  async function computeNow(opts) {
    await ready;
    check();
    // Same steps as the page's own year / class / exam / month change handlers.
    state.parentMode = false;
    state.parentAdm = null;
    state.stream = '';
    state.year = Number(opts.year);
    state.classKey = normalizeDisplayClass(opts.className);
    state.className = normalizeDisplayClass(state.classKey);
    state.examType = opts.examLabel;
    state.examKey = getExamKeyFromLabel(state.examType);
    if (state.examType === 'Annual' || state.examKey === 'annual') state.monthRaw = 'All';
    else if (opts.month) { state.month = opts.month; state.monthRaw = preferredMonthStorage(state.month, state.monthRaw); }
    state.subjects = subjectListForClass(state.className, state.year);
    lastError = null;
    current = null;
    const before = RUNTIME.loadSeq;
    await loadAllData();
    if (RUNTIME.loadSeq !== before + 1) throw new Error('Ukurasa wa ripoti ulianza upakiaji mwingine. Jaribu tena.');
    if (lastError) throw new Error(lastError);
    if (state.className !== normalizeDisplayClass(opts.className) || state.examType !== opts.examLabel) throw new Error('Uchaguzi wa darasa/mtihani haukukubaliwa na ukurasa wa ripoti.');
    current = { className: state.className, examLabel: state.examType, year: String(state.year), month: state.month };
  }

  async function run(opts) {
    await computeNow(opts);
    const students = Array.isArray(state.students) ? state.students : [];
    return {
      className: state.className,
      examKey: state.examKey,
      examLabel: state.examType,
      month: state.month,
      year: String(state.year),
      cohortSize: state.students.length || state.filtered.length || 0,
      students: students.map((s) => ({
        adm: String(s.adm || ''),
        admissionNo: String(s.admissionNo || s.adm || ''),
        name: s.name,
        class: s.class,
        hasResults: Number(s.attemptedCount || (s.subjectStats && s.subjectStats.attemptedCount) || 0) > 0 && s.overallPosition !== '-',
        parentContact: s.parentContact,
        card: cardFigures(s),
      })),
    };
  }

  /** The child's report card: drawReportCard() on the same A4 document as the page's "Download PDF". */
  async function cardPdf(opts, adm) {
    const same = current && current.className === normalizeDisplayClass(opts.className) && current.examLabel === opts.examLabel
      && current.year === String(opts.year) && (opts.examLabel === 'Annual' || !opts.month || current.month === opts.month);
    if (!same) await computeNow(opts);
    check();
    await ensurePdfLibsLoaded();
    const s = state.students.find((x) => x.adm === adm);
    if (!s) throw new Error('Mwanafunzi hayupo kwenye ripoti ya darasa hili.');
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await drawReportCard(doc, s);
    const monthSlug = (state.month === 'All' ? 'Annual' : state.month);
    return {
      filename: `report_${s.adm}_${state.className}_${state.year}_${state.examKey}_${monthSlug}.pdf`,
      bytes: new Uint8Array(doc.output('arraybuffer')),
    };
  }

  let queue = Promise.resolve();
  const serial = (fn) => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };

  window.SomapReportBridge = {
    version: 2,
    ready: () => ready,
    exams: () => { check(); return getAllExamOptions().map((e) => ({ label: e.label, key: e.key })); },
    classes: () => (typeof CLASS_ORDER !== 'undefined' && Array.isArray(CLASS_ORDER) ? CLASS_ORDER.slice() : []),
    months: () => (typeof MONTHS !== 'undefined' && Array.isArray(MONTHS) ? MONTHS.slice() : []),
    // One at a time: the page has a single state.
    compute: (opts) => serial(() => run(opts)),
    cardPdf: (opts, adm) => serial(() => cardPdf(opts, adm)),
  };
})();
