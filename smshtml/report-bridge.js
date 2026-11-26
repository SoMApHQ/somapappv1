/*
 * SoMAp Matokeo — READ-ONLY bridge into Toacademichtml/generatereportform.html.
 *
 * Mawasiliano opens the real report page in a hidden frame (same site) and adds
 * this script to it. For each child the bridge does exactly what a person does
 * on the page before pressing "Download PDF":
 *   1. picks year, class, exam and month with the same steps as the page's own
 *      dropdown handlers (attachListeners + populateMonthOptions: Annual = "All");
 *   2. waits for the page's own follow-up loading to finish (student details incl.
 *      passport photos, the school logo, the selected child's fee details);
 *   3. selects the child (setSelectedStudent) and runs the page's OWN
 *      generateSinglePdf(adm) — the Download PDF button's code — capturing the
 *      file it would save (same bytes, same file name) instead of saving it.
 * Photos are waited for (with retries) before the PDF is drawn.
 * verify() runs the button a second time after the page settles and compares the
 * two files, so a missing photo or any other difference is caught before sending.
 * Nothing is redesigned or written. If the page changes, the bridge refuses.
 */
(function () {
  'use strict';
  if (window.SomapReportBridge) return;

  const NEEDED = {
    loadAllData: () => typeof loadAllData, getAllExamOptions: () => typeof getAllExamOptions, getExamKeyFromLabel: () => typeof getExamKeyFromLabel,
    normalizeDisplayClass: () => typeof normalizeDisplayClass, preferredMonthStorage: () => typeof preferredMonthStorage,
    populateMonthOptions: () => typeof populateMonthOptions, subjectListForClass: () => typeof subjectListForClass,
    gradeFromPercent: () => typeof gradeFromPercent, toNormalizedRows: () => typeof toNormalizedRows, studentPercentFrom: () => typeof studentPercentFrom,
    isNumber: () => typeof isNumber, ensurePdfLibsLoaded: () => typeof ensurePdfLibsLoaded, generateSinglePdf: () => typeof generateSinglePdf,
    setSelectedStudent: () => typeof setSelectedStudent, fetchStudentDetailsMapCached: () => typeof fetchStudentDetailsMapCached,
    applyStudentDetailsToState: () => typeof applyStudentDetailsToState, loadFinanceSummaryForStudent: () => typeof loadFinanceSummaryForStudent,
    applyFinanceEntryToStudent: () => typeof applyFinanceEntryToStudent, preloadLogo: () => typeof preloadLogo,
    resolveStudentPhoto: () => typeof resolveStudentPhoto, transformToJpegIfCloudinary: () => typeof transformToJpegIfCloudinary,
    loadImageAsDataURL: () => typeof loadImageAsDataURL, getAssignmentForStudent: () => typeof getAssignmentForStudent,
    getTeacherPhotoData: () => typeof getTeacherPhotoData,
    collectExamWindowRecords: () => typeof collectExamWindowRecords, mergeWindowRecords: () => typeof mergeWindowRecords,
  };
  function missingPieces() {
    const missing = [];
    if (typeof state !== 'object' || !state) missing.push('state');
    if (typeof RUNTIME !== 'object' || !RUNTIME) missing.push('RUNTIME');
    Object.entries(NEEDED).forEach(([name, t]) => { let v; try { v = t(); } catch (_) { v = 'undefined'; } if (v !== 'function') missing.push(name); });
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait until the page finished booting and its idle-time setup (exam list, logo) ran.
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

  function setSelect(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.value = String(value);
  }

  let current = null; // the year/class/exam/month the page is showing now

  const sameRequest = (opts) => current && current.className === normalizeDisplayClass(opts.className) && current.examLabel === opts.examLabel
    && current.year === String(opts.year) && (current.examLabel === 'Annual' || current.month === opts.month);

  async function computeNow(opts) {
    await ready;
    check();
    current = null;
    lastError = null;
    // Same steps as the page's own year / class / exam / month change handlers.
    state.parentMode = false;
    state.parentAdm = null;
    state.stream = '';
    state.year = Number(opts.year);
    setSelect('yearSelect', state.year);
    state.classKey = normalizeDisplayClass(opts.className);
    state.className = normalizeDisplayClass(state.classKey);
    setSelect('classSelect', state.classKey);
    state.examType = opts.examLabel;
    state.examKey = getExamKeyFromLabel(state.examType);
    setSelect('examType', state.examType);
    if (state.examType !== 'Annual' && opts.month) state.month = opts.month;
    populateMonthOptions(); // Annual -> month 'All' + monthRaw 'All', exactly as the page does
    if (state.examType !== 'Annual' && opts.month) {
      state.month = opts.month;
      state.monthRaw = preferredMonthStorage(state.month, state.monthRaw);
      setSelect('monthSelect', state.month);
    }
    state.subjects = subjectListForClass(state.className, state.year);
    const before = RUNTIME.loadSeq;
    await loadAllData();
    if (RUNTIME.loadSeq !== before + 1) throw new Error('Ukurasa wa ripoti ulianza upakiaji mwingine. Jaribu tena.');
    if (lastError) throw new Error(lastError);
    if (state.className !== normalizeDisplayClass(opts.className) || state.examType !== opts.examLabel) throw new Error('Uchaguzi wa darasa/mtihani haukukubaliwa na ukurasa wa ripoti.');
    // The page's own follow-up loading (normally run by its timers): student details incl. photos, logo.
    const detailsMap = await fetchStudentDetailsMapCached();
    if (detailsMap && Object.keys(detailsMap).length) applyStudentDetailsToState(detailsMap);
    if (!state.logoDataUrl) await preloadLogo();
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

  // Photos are retried (slow networks), but once the photo server keeps refusing (e.g. the
  // Cloudinary account is blocked), stop waiting: try each photo once, never hold up sending.
  let photoFailuresInARow = 0;
  async function loadWithRetry(fn, tries) {
    const attempts = photoFailuresInARow >= 3 ? 1 : tries;
    for (let i = 0; i < attempts; i++) {
      const v = await fn();
      if (v) { photoFailuresInARow = 0; return v; }
      if (i < attempts - 1) await sleep(600 * (i + 1));
    }
    photoFailuresInARow += 1;
    return null;
  }

  /** Select the child like a person would, finish the page's fee and photo loading, and make sure photos load. */
  async function prepareChild(adm) {
    const s = state.students.find((x) => x.adm === adm);
    if (!s) throw new Error('Mwanafunzi hayupo kwenye ripoti ya darasa hili.');
    setSelectedStudent(adm);
    // Same as the page's scheduleSelectedFinanceHydration job, awaited.
    const hasSchedule = Array.isArray(s.feeSchedule) && s.feeSchedule.length > 0;
    const hasPlan = String(s.feePlanName || '').trim() && String(s.feePlanName || '').trim() !== 'Not set';
    if (!(hasSchedule && hasPlan)) {
      const entry = await loadFinanceSummaryForStudent(s, state.year);
      if (entry) applyFinanceEntryToStudent(adm, entry);
    }
    // Photos: wait until every photo that exists has really loaded (the page draws only what loads).
    const warnings = [];
    const photoUrl = String(resolveStudentPhoto(s) || '').trim();
    if (photoUrl) {
      const url = transformToJpegIfCloudinary(photoUrl, 600, 800) || photoUrl;
      if (!(await loadWithRetry(() => loadImageAsDataURL(url), 3))) warnings.push('picha ya mwanafunzi haikupakia');
    }
    const assignment = getAssignmentForStudent(s) || {};
    for (const [label, person] of [['mwalimu wa darasa', assignment.classTeacher], ['mwalimu msaidizi', assignment.assistantTeacher]]) {
      if (!person || !person.photoUrl) continue;
      const key = String(person.photoUrl);
      if (state.classTeacherPhotoCache.has(key) && !state.classTeacherPhotoCache.get(key)) state.classTeacherPhotoCache.delete(key); // forget an earlier failed try
      const ok = await loadWithRetry(async () => {
        const data = await getTeacherPhotoData(person);
        if (!data) state.classTeacherPhotoCache.delete(key);
        return data;
      }, 3);
      if (!ok) warnings.push(`picha ya ${label} haikupakia`);
    }
    if (!state.logoDataUrl) warnings.push('nembo ya shule haikupakia');
    return { s, warnings };
  }

  /**
   * The page's own "Download PDF" (generateSinglePdf), with the file captured instead of saved.
   * In jsPDF 2.x, save() is created inside EACH new document (jsPDF.API is only the plugin store),
   * so we briefly wrap the constructor the button calls: every document it creates gets a save()
   * that hands us the bytes. The real jsPDF (with all plugins) does all the drawing; it is put
   * back right after.
   */
  async function buttonPdf(adm) {
    await ensurePdfLibsLoaded();
    const lib = window.jspdf;
    const Original = lib && lib.jsPDF;
    if (typeof Original !== 'function') throw new Error('PDF ya ukurasa wa ripoti haipatikani (jsPDF).');
    let captured = null;
    function CapturingJsPDF() {
      const doc = new Original(...arguments);
      doc.save = function (filename) {
        captured = { filename: String(filename || 'report.pdf'), bytes: new Uint8Array(doc.output('arraybuffer')) };
        return doc;
      };
      return doc;
    }
    CapturingJsPDF.prototype = Original.prototype;
    Object.keys(Original).forEach((k) => { CapturingJsPDF[k] = Original[k]; }); // API (plugins), version, ...
    CapturingJsPDF.API = Original.API;
    lib.jsPDF = CapturingJsPDF;
    try {
      lastError = null;
      await generateSinglePdf(adm);
    } finally {
      lib.jsPDF = Original;
    }
    if (lastError) throw new Error(lastError);
    if (!captured) throw new Error('Ukurasa wa ripoti haukutoa PDF ya mwanafunzi huyu.');
    return captured;
  }

  async function cardPdf(opts, adm) {
    if (!sameRequest(opts)) await computeNow(opts);
    check();
    const { s, warnings } = await prepareChild(adm);
    const pdf = await buttonPdf(adm);
    return { ...pdf, card: cardFigures(s), warnings };
  }

  // jsPDF stamps each file with its creation time and a random file ID; everything else must match.
  function normalisePdf(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return text.replace(/\/CreationDate \(D:[^)]*\)/g, '/CreationDate ()').replace(/\/ModDate \(D:[^)]*\)/g, '/ModDate ()').replace(/\/ID \[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/g, '/ID []');
  }
  const countPages = (text) => (text.match(/\/Type \/Page[^s]/g) || []).length;
  const countImages = (text) => (text.match(/\/Subtype \/Image/g) || []).length;

  /** Check before sending: link PDF vs a fresh press of the page's own Download PDF for the same child. */
  async function verify(opts, adm) {
    const link = await cardPdf(opts, adm);
    await sleep(1500); // let any of the page's own timers finish, as if a person clicked a moment later
    const again = await prepareChild(adm);
    const button = await buttonPdf(adm);
    const a = normalisePdf(link.bytes);
    const b = normalisePdf(button.bytes);
    const result = {
      same: a === b && link.filename === button.filename,
      filename: link.filename,
      buttonFilename: button.filename,
      pages: countPages(a),
      images: countImages(a),
      buttonPages: countPages(b),
      buttonImages: countImages(b),
      bytes: link.bytes.length,
      warnings: Array.from(new Set([...link.warnings, ...again.warnings])),
    };
    if (!result.same) {
      result.reason = link.filename !== button.filename ? 'jina la faili ni tofauti'
        : result.pages !== result.buttonPages ? 'idadi ya kurasa ni tofauti'
          : result.images !== result.buttonImages ? 'picha ni tofauti (picha moja haikupakia)'
            : 'maudhui ya PDF ni tofauti';
    }
    return result;
  }

  /**
   * Which months / exams have scores for a class (read-only probe with the page's own score
   * readers; no state is changed). Used to say "choose another month" helpfully.
   */
  async function availability(opts) {
    await ready;
    check();
    const year = Number(opts.year);
    const className = normalizeDisplayClass(opts.className);
    const has = async (examKey, month) => {
      try {
        const records = await collectExamWindowRecords({ year, className, examKey, month, rawMonth: month ? preferredMonthStorage(month) : '' });
        const merged = mergeWindowRecords(records) || {};
        return Object.keys(merged.mergedScores || {}).length > 0;
      } catch (_) { return false; }
    };
    const months = [];
    for (const m of (typeof MONTHS !== 'undefined' ? MONTHS : [])) { if (await has('monthly', m)) months.push(m); }
    const exams = [];
    for (const e of getAllExamOptions()) {
      if (e.key === 'monthly' || e.key === 'annual') continue;
      if (await has(e.key, state.month && state.month !== 'All' ? state.month : 'Jan')) exams.push(e.label);
    }
    return { months, exams };
  }

  let queue = Promise.resolve();
  const serial = (fn) => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };

  window.SomapReportBridge = {
    version: 3,
    ready: () => ready,
    exams: () => { check(); return getAllExamOptions().map((e) => ({ label: e.label, key: e.key })); },
    classes: () => (typeof CLASS_ORDER !== 'undefined' && Array.isArray(CLASS_ORDER) ? CLASS_ORDER.slice() : []),
    months: () => (typeof MONTHS !== 'undefined' && Array.isArray(MONTHS) ? MONTHS.slice() : []),
    // One at a time: the page has a single state.
    compute: (opts) => serial(() => run(opts)),
    cardPdf: (opts, adm) => serial(() => cardPdf(opts, adm)),
    verify: (opts, adm) => serial(() => verify(opts, adm)),
    availability: (opts) => serial(() => availability(opts)),
  };
})();
