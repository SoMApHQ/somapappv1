(function () {
  "use strict";

  const TABS = [
    "Recap",
    "Upload Result",
    "Schools & PSLE Strength",
    "Subject Accountability",
    "Pupil Movement",
    "Teacher Responsibility",
    "Action Plans",
    "PDF Reports",
  ];
  const UNMAPPED = "Teacher not yet mapped in SoMAp profile.";
  const SUBJECT_ALIASES = {
    KSW: "Kiswahili",
    KISW: "Kiswahili",
    KISWAHILI: "Kiswahili",
    ENG: "English",
    ENGLISH: "English",
    CME: "Civics & Morals",
    CIVICS: "Civics & Morals",
    "CIVICS & MORALS": "Civics & Morals",
    "CIVICS AND MORALS": "Civics & Morals",
    MATH: "Mathematics",
    MATHEMATICS: "Mathematics",
    HISABATI: "Mathematics",
    SST: "Social Studies",
    "SOCIAL STUDIES": "Social Studies",
    SOCIAL: "Social Studies",
    SCI: "Science",
    SCIE: "Science",
    SCIENCE: "Science",
    GEOGRAPHY: "Geography",
    HISTORY: "History",
    ARTS: "Arts",
    FRENCH: "French",
    "VOCATIONAL SKILLS": "Vocational Skills",
    "V/SKILLS": "Vocational Skills",
    VS: "Vocational Skills",
  };
  const TOTAL_ALIASES = new Set(["TOT", "TOTAL"]);
  const AVERAGE_ALIASES = new Set(["AV", "AVG", "AVERAGE", "AVE"]);
  const GRADE_ALIASES = new Set(["GRD", "GRADE"]);
  const POSITION_ALIASES = new Set(["POS", "POSITION"]);
  const NAME_ALIASES = new Set(["NAME", "PUPIL", "PUPIL NAME", "STUDENT", "STUDENT NAME", "SCHOOL", "SCHOOL NAME"]);
  const ADM_ALIASES = new Set(["ADM", "ADM NO", "ADMISSION", "ADMISSION NO", "INDEX", "STUDENT ID", "PUPIL ID"]);

  const state = {
    school: null,
    schoolId: "socrates-school",
    className: "",
    year: "",
    user: null,
    safeEmail: "",
    schoolName: "Socrates School",
    schoolLogoDataUrl: "",
    exams: [],
    latest: null,
    previous: null,
    first: null,
    teacherMap: {},
    psleRecords: {},
    actionPlans: {},
    pendingPreview: null,
  };

  const $ = (id) => document.getElementById(id);
  const dom = {
    tabs: $("tabs"),
    recapGrid: $("recapGrid"),
    historyBox: $("historyBox"),
    previewBox: $("previewBox"),
    uploadForm: $("uploadForm"),
    confirmSaveBtn: $("confirmSaveBtn"),
    toast: $("toast"),
    accessNotice: $("accessNotice"),
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (!window.firebase?.apps?.length || !window.SOMAP?.P) {
      showAccess("Firebase or SoMAp context is not ready.");
      return;
    }
    const query = new URLSearchParams(location.search);
    const requestedSchool = query.get("school") || localStorage.getItem("somap.currentSchoolId") || "socrates-school";
    if (requestedSchool && window.SOMAP?.setSchoolId) window.SOMAP.setSchoolId(requestedSchool);
    state.school = window.SOMAP.getSchool?.() || { id: requestedSchool, name: "Socrates School" };
    state.schoolId = state.school.id || requestedSchool;
    state.schoolName = state.school.name || (state.schoolId === "socrates-school" ? "Socrates School" : state.schoolId);
    state.className = toDisplayClass(query.get("class") || sessionStorage.getItem("assignedClass") || "");
    state.year = String(query.get("year") || window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear());

    if (!isAllowedClass(state.className)) {
      showAccess("Joint Exam Intelligence is currently enabled for Class 7 and Class 4 only.");
      return;
    }

    $("classLabel").textContent = state.className;
    $("yearLabel").textContent = state.year;
    $("schoolLabel").textContent = state.schoolName;
    $("classInput").value = state.className;
    $("yearInput").value = state.year;
    $("backBtn").addEventListener("click", () => history.back());
    if (window.SomapLogo) {
      SomapLogo.loadSchoolLogo({
        defaultLogo: "../images/socrates_logo.png",
        fallbackLogo: "../images/somap-logo.png.jpg",
      });
    }
    state.schoolLogoDataUrl = await loadImageDataUrl("../images/socrates_logo.png").catch(() => "");

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        showAccess("Please sign in through SoMAp before using this report.");
        return;
      }
      state.user = user;
      state.safeEmail = String(user.email || "").replace(/\./g, "_");
      renderTabs();
      bindUpload();
      await Promise.all([loadTeacherMap(), loadExams(), loadPsleRecords()]);
      await loadActionPlans();
      renderAll();
    });
  }

  function showAccess(message) {
    dom.accessNotice.textContent = message;
    dom.accessNotice.classList.remove("hidden");
  }

  function db() {
    return firebase.database();
  }

  function ref(path) {
    return db().ref(window.SOMAP.P(path));
  }

  function legacyAwareRefPath(path) {
    return window.SOMAP.P(path);
  }

  function classKey() {
    return encodeURIComponent(state.className);
  }

  function normalizeToken(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  function normalizeKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function toDisplayClass(value) {
    const raw = String(value || "").trim();
    const key = normalizeKey(raw);
    if (key === "class7" || key === "std7" || key === "standard7") return "Class 7";
    if (key === "class4" || key === "std4" || key === "standard4") return "Class 4";
    return raw;
  }

  function isAllowedClass(value) {
    return ["class7", "class4"].includes(normalizeKey(value));
  }

  function canonicalSubject(value) {
    const cleaned = normalizeToken(value).replace(/\./g, "").replace(/\s*\/\s*/g, "/");
    return SUBJECT_ALIASES[cleaned] || SUBJECT_ALIASES[cleaned.replace(/\s+/g, " ")] || "";
  }

  function safeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fmt(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : "-";
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.remove("hidden");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => dom.toast.classList.add("hidden"), 3200);
  }

  function renderTabs() {
    dom.tabs.innerHTML = TABS.map((tab, index) => `<button class="tab-btn rounded-xl px-4 py-3 text-sm font-black ${index === 0 ? "active" : ""}" data-tab="${safeHtml(tab)}">${safeHtml(tab)}</button>`).join("");
    dom.tabs.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tab]");
      if (btn) activateTab(btn.dataset.tab);
    });
    document.querySelectorAll("[data-tab-jump]").forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.tabJump)));
  }

  function activateTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
    TABS.forEach((name) => {
      const panel = $("panel-" + name);
      if (panel) panel.classList.toggle("hidden-panel", name !== tab);
    });
  }

  function bindUpload() {
    dom.uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = $("excelFile").files?.[0];
      if (!file) return showToast("Please choose an Excel file.");
      try {
        state.pendingPreview = await parseExcel(file);
        state.pendingPreview.meta = collectUploadMeta(file);
        renderPreview(state.pendingPreview);
        dom.confirmSaveBtn.classList.remove("hidden");
      } catch (error) {
        console.error(error);
        showToast("Could not parse this Excel file. Check the format and try again.");
      }
    });
    dom.confirmSaveBtn.addEventListener("click", savePreview);
  }

  function collectUploadMeta(file) {
    const pdf = $("pdfFile").files?.[0] || null;
    return {
      examDate: $("examDate").value,
      jointName: $("jointName").value.trim(),
      notes: $("notes").value.trim(),
      sourceFileName: file.name,
      pdfEvidenceUrlOrName: pdf ? pdf.name : "",
    };
  }

  async function parseExcel(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const warnings = [];
    const sheets = workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" }),
    }));
    const candidates = [];
    sheets.forEach((sheet) => candidates.push(...extractTablesFromRows(sheet.rows, sheet.name)));
    const schoolsTable = chooseSchoolTable(candidates);
    const pupilTable = choosePupilTable(candidates);
    if (!schoolsTable) warnings.push("School summary table was inferred with low confidence or not found.");
    if (!pupilTable) warnings.push("Socrates pupil table was inferred with low confidence or not found.");
    const schools = schoolsTable ? schoolsTable.rows : [];
    const pupils = pupilTable ? pupilTable.rows : [];
    const subjects = unique([...(schoolsTable?.subjects || []), ...(pupilTable?.subjects || [])]);
    const socratesSummary = schools.find((row) => isSocratesName(row.school || row.name)) || null;
    if (!socratesSummary) warnings.push("Socrates row was not confidently found in the participating schools table.");
    if (!subjects.length) warnings.push("No subject columns were confidently detected.");
    const subjectSummary = buildSubjectSummary(subjects, pupils, socratesSummary);
    return {
      sheets: sheets.map((s) => s.name),
      subjects,
      schools,
      socratesSummary,
      pupils,
      subjectSummary,
      warnings,
    };
  }

  function extractTablesFromRows(rows, sheetName) {
    const tables = [];
    rows.forEach((row, index) => {
      const headers = row.map((cell) => normalizeToken(cell));
      const subjectCols = [];
      const fieldCols = {};
      headers.forEach((header, col) => {
        const subject = canonicalSubject(header);
        if (subject) subjectCols.push({ col, subject });
        if (TOTAL_ALIASES.has(header)) fieldCols.total = col;
        if (AVERAGE_ALIASES.has(header)) fieldCols.average = col;
        if (GRADE_ALIASES.has(header)) fieldCols.grade = col;
        if (POSITION_ALIASES.has(header)) fieldCols.position = col;
        if (NAME_ALIASES.has(header)) fieldCols.name = col;
        if (ADM_ALIASES.has(header)) fieldCols.adm = col;
      });
      if (!subjectCols.length && Object.keys(fieldCols).length < 2) return;
      const dataRows = [];
      for (let r = index + 1; r < rows.length; r += 1) {
        const raw = rows[r] || [];
        const nonEmpty = raw.filter((cell) => String(cell || "").trim() !== "").length;
        if (!nonEmpty) {
          if (dataRows.length) break;
          continue;
        }
        const name = String(raw[fieldCols.name ?? 0] || "").trim();
        if (!name && nonEmpty < 2) continue;
        const record = {
          name,
          school: name,
          adm: fieldCols.adm != null ? String(raw[fieldCols.adm] || "").trim() : "",
          total: fieldCols.total != null ? num(raw[fieldCols.total]) : null,
          average: fieldCols.average != null ? num(raw[fieldCols.average]) : null,
          grade: fieldCols.grade != null ? String(raw[fieldCols.grade] || "").trim() : "",
          position: fieldCols.position != null ? String(raw[fieldCols.position] || "").trim() : "",
          subjects: {},
          sourceSheet: sheetName,
        };
        subjectCols.forEach(({ col, subject }) => {
          const value = num(raw[col]);
          if (value !== null) record.subjects[subject] = value;
        });
        if (!record.average && Object.keys(record.subjects).length) {
          record.average = average(Object.values(record.subjects));
        }
        dataRows.push(record);
      }
      if (dataRows.length) {
        tables.push({
          sheetName,
          headerRow: index,
          rows: dataRows,
          subjects: unique(subjectCols.map((x) => x.subject)),
          hasAdm: fieldCols.adm != null,
          hasSchoolSignals: dataRows.some((r) => isSocratesName(r.name)) || dataRows.length < 35,
          hasPupilSignals: fieldCols.adm != null || dataRows.length > 12,
        });
      }
    });
    return tables;
  }

  function chooseSchoolTable(tables) {
    return tables
      .filter((t) => t.rows.length >= 2)
      .sort((a, b) => scoreSchoolTable(b) - scoreSchoolTable(a))[0] || null;
  }

  function choosePupilTable(tables) {
    return tables
      .filter((t) => t.rows.length >= 3)
      .sort((a, b) => scorePupilTable(b) - scorePupilTable(a))[0] || null;
  }

  function scoreSchoolTable(t) {
    return (t.hasSchoolSignals ? 20 : 0) + (t.rows.some((r) => isSocratesName(r.name)) ? 40 : 0) + (t.rows.length <= 30 ? 12 : 0) + t.subjects.length;
  }

  function scorePupilTable(t) {
    return (t.hasAdm ? 35 : 0) + (t.rows.length > 10 ? 25 : 0) + (t.rows.some((r) => isSocratesName(r.name)) ? -30 : 0) + t.subjects.length;
  }

  function isSocratesName(value) {
    return normalizeKey(value).includes("socrates");
  }

  function unique(list) {
    return [...new Set((list || []).filter(Boolean))];
  }

  function average(values) {
    const nums = values.map(Number).filter(Number.isFinite);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  function buildSubjectSummary(subjects, pupils, socratesSummary) {
    const summary = {};
    subjects.forEach((subject) => {
      const values = pupils.map((p) => p.subjects?.[subject]).filter(Number.isFinite);
      summary[subject] = {
        subject,
        average: values.length ? average(values) : socratesSummary?.subjects?.[subject] ?? null,
        weakPupils: pupils.filter((p) => Number(p.subjects?.[subject]) < 30).map((p) => pupilName(p)),
        highPerformers: pupils.filter((p) => Number(p.subjects?.[subject]) >= 40).map((p) => pupilName(p)),
      };
    });
    return summary;
  }

  function pupilName(p) {
    return p.name || p.adm || "Unnamed pupil";
  }

  function renderPreview(preview) {
    dom.previewBox.innerHTML = `
      ${preview.warnings.length ? `<div class="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 p-3 mb-4"><b>Warnings:</b><br>${preview.warnings.map(safeHtml).join("<br>")}</div>` : ""}
      <div class="grid sm:grid-cols-3 gap-3 mb-4">
        ${mini("Sheets parsed", preview.sheets.length)}
        ${mini("Detected subjects", preview.subjects.length)}
        ${mini("Socrates pupils", preview.pupils.length)}
      </div>
      <h4 class="font-black text-slate-900 mb-2">Detected Subjects</h4>
      <p class="mb-4">${preview.subjects.map(safeHtml).join(", ") || "None"}</p>
      <h4 class="font-black text-slate-900 mb-2">Participating Schools</h4>
      ${table(["School", "Average", "Grade", "Position"], preview.schools.slice(0, 12).map((r) => [r.school || r.name, fmt(r.average), r.grade, r.position]))}
      <h4 class="font-black text-slate-900 mt-4 mb-2">Socrates Summary</h4>
      ${preview.socratesSummary ? table(["Average", "Grade", "Position", "Total"], [[fmt(preview.socratesSummary.average), preview.socratesSummary.grade, preview.socratesSummary.position, fmt(preview.socratesSummary.total, 0)]]) : "<p>Socrates row not found.</p>"}
      <h4 class="font-black text-slate-900 mt-4 mb-2">Socrates Pupil Sample</h4>
      ${table(["Pupil", "ADM", "Average", "Grade"], preview.pupils.slice(0, 12).map((r) => [pupilName(r), r.adm, fmt(r.average), r.grade]))}
    `;
  }

  function mini(label, value) {
    return `<div class="rounded-xl bg-white border border-slate-200 p-3"><div class="text-xl font-black">${safeHtml(value)}</div><div class="text-xs text-slate-500">${safeHtml(label)}</div></div>`;
  }

  function table(headers, rows) {
    if (!rows.length) return `<div class="text-sm text-slate-500">No rows available.</div>`;
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${safeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${safeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  async function savePreview() {
    const preview = state.pendingPreview;
    if (!preview) return;
    if (!preview.meta.examDate || !preview.meta.jointName) return showToast("Exam date and joint title are required.");
    const now = Date.now();
    const examId = ref(`academicJointExams/${state.year}/${classKey()}`).push().key;
    const previousExams = state.exams.slice();
    const payload = {
      examId,
      schoolId: state.schoolId,
      className: state.className,
      year: state.year,
      examDate: preview.meta.examDate,
      jointName: preview.meta.jointName,
      uploadedByUid: state.user.uid,
      uploadedByName: state.user.displayName || state.user.email || "",
      uploadedAt: now,
      sourceFileName: preview.meta.sourceFileName,
      pdfEvidenceUrlOrName: preview.meta.pdfEvidenceUrlOrName,
      notes: preview.meta.notes,
      subjects: preview.subjects,
      schools: preview.schools,
      socratesSummary: preview.socratesSummary,
      pupils: preview.pupils,
      subjectSummary: preview.subjectSummary,
      analysis: buildAnalysis(preview, previousExams),
      warnings: preview.warnings,
      createdAt: now,
      updatedAt: now,
    };
    const nextExams = previousExams.concat(payload).sort(compareExamDate);
    const latest = nextExams[nextExams.length - 1];
    const previous = nextExams.length > 1 ? nextExams[nextExams.length - 2] : null;
    latest.analysis = buildAnalysis(latest, nextExams.slice(0, -1));
    const stats = buildLatestStats(latest, previous);
    const updates = {};
    updates[legacyAwareRefPath(`academicJointExams/${state.year}/${classKey()}/${examId}`)] = latest;
    updates[legacyAwareRefPath(`academicJointExamStats/${state.year}/${classKey()}`)] = stats;
    await db().ref().update(updates);
    showToast("Joint exam analysis saved.");
    dom.confirmSaveBtn.classList.add("hidden");
    state.pendingPreview = null;
    $("uploadForm").reset();
    $("classInput").value = state.className;
    $("yearInput").value = state.year;
    await loadExams();
    await loadActionPlans();
    renderAll();
    activateTab("Recap");
  }

  function compareExamDate(a, b) {
    return String(a.examDate || "").localeCompare(String(b.examDate || "")) || String(a.createdAt || 0).localeCompare(String(b.createdAt || 0));
  }

  async function loadExams() {
    const snap = await ref(`academicJointExams/${state.year}/${classKey()}`).once("value");
    const raw = snap.val() || {};
    state.exams = Object.values(raw).sort(compareExamDate);
    state.latest = state.exams[state.exams.length - 1] || null;
    state.previous = state.exams.length > 1 ? state.exams[state.exams.length - 2] : null;
    state.first = state.exams[0] || null;
  }

  async function loadTeacherMap() {
    const [cfgSnap, workersSnap] = await Promise.all([
      scopedOrRoot(`years/${state.year}/teachers_config`, `teachers_config`),
      scopedOrRoot(`years/${state.year}/workers`, `workers`),
    ]);
    const configs = cfgSnap.val() || {};
    const workers = workersSnap.val() || {};
    const names = {};
    Object.entries(workers).forEach(([id, item]) => {
      const p = item?.profile || item || {};
      names[id] = p.fullNameUpper || p.fullName || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ") || id;
    });
    const map = {};
    Object.entries(configs).forEach(([workerId, cfg]) => {
      const teacherName = names[workerId] || cfg.name || cfg.teacherName || workerId;
      (cfg.classSubjectMappings || []).forEach((mapping) => {
        if (normalizeKey(mapping.class) !== normalizeKey(state.className)) return;
        const subjects = [...(mapping.subjects || []), ...((mapping.streams || []).flatMap((s) => s.subjects || []))];
        unique(subjects.map((s) => canonicalSubject(s) || s)).forEach((subject) => {
          if (!subject) return;
          map[subject] = map[subject] || [];
          if (!map[subject].some((t) => t.workerId === workerId)) map[subject].push({ workerId, name: teacherName });
        });
      });
    });
    state.teacherMap = map;
    const updates = {};
    Object.entries(map).forEach(([subject, teachers]) => {
      updates[legacyAwareRefPath(`classSubjectTeachers/${state.year}/${classKey()}/${safeKey(subject)}`)] = teachers;
    });
    if (Object.keys(updates).length) await db().ref().update(updates).catch(() => {});
  }

  async function scopedOrRoot(scopedPath, rootPath) {
    const scoped = await ref(scopedPath).once("value");
    if (scoped.exists()) return scoped;
    if (state.schoolId === "socrates-school") return db().ref(rootPath).once("value");
    return scoped;
  }

  function safeKey(value) {
    return String(value || "").replace(/[.#$\[\]/]/g, "_");
  }

  async function loadPsleRecords() {
    const snap = await ref("psleSchoolRecords").once("value");
    state.psleRecords = snap.val() || {};
  }

  async function loadActionPlans() {
    if (!state.latest?.examId) {
      state.actionPlans = {};
      return;
    }
    const snap = await ref(`jointExamActionPlans/${state.year}/${classKey()}/${state.latest.examId}`).once("value");
    state.actionPlans = snap.val() || {};
  }

  function buildLatestStats(latest, previous) {
    const riskSubjects = Object.values(latest.subjectSummary || {}).filter((s) => Number(s.average) < 35).map((s) => s.subject);
    const trend = previous ? {
      averageChange: delta(latest.socratesSummary?.average, previous.socratesSummary?.average),
      positionChange: delta(Number(previous.socratesSummary?.position), Number(latest.socratesSummary?.position)),
    } : null;
    const competition = competitionReading(latest);
    return {
      latestExamId: latest.examId,
      latestExamDate: latest.examDate,
      latestAverage: latest.socratesSummary?.average ?? null,
      latestGrade: latest.socratesSummary?.grade || "",
      latestPosition: latest.socratesSummary?.position || "",
      totalSchools: latest.schools?.length || 0,
      riskSubjects,
      trendVsPrevious: trend,
      competitionStrengthLabel: competition.label,
      updatedAt: Date.now(),
    };
  }

  function delta(a, b) {
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? y - x : null;
  }

  function renderAll() {
    renderRecapCards();
    renderHistory();
    renderRecap();
    renderSchoolsPsle();
    renderSubjectAccountability();
    renderPupilMovement();
    renderTeacherResponsibility();
    renderActionPlans();
    renderPdfReports();
  }

  function recapValues() {
    const latest = state.latest;
    const subjects = Object.values(latest?.subjectSummary || {});
    const sorted = subjects.slice().sort((a, b) => Number(b.average) - Number(a.average));
    const movement = subjectMovement();
    const danger = latest?.pupils?.filter((p) => Number(p.average) < 30).length || 0;
    return [
      ["Latest Average", fmt(latest?.socratesSummary?.average), "blue"],
      ["Grade", latest?.socratesSummary?.grade || "-", "blue"],
      ["Position", latest?.socratesSummary?.position || "-", "blue"],
      ["Competition Strength", latest ? competitionReading(latest).label : "-", "amber"],
      ["Best Subject", sorted[0] ? `${sorted[0].subject} ${fmt(sorted[0].average)}` : "-", "green"],
      ["Worst Subject", sorted[sorted.length - 1] ? `${sorted[sorted.length - 1].subject} ${fmt(sorted[sorted.length - 1].average)}` : "-", "red"],
      ["Biggest Improvement", movement.best ? `${movement.best.subject} +${fmt(movement.best.change)}` : "-", "green"],
      ["Biggest Decline", movement.worst ? `${movement.worst.subject} ${fmt(movement.worst.change)}` : "-", "red"],
      ["Pupils in Danger", danger, danger ? "red" : "green"],
      ["Action Plans Due", actionPlansDue(), actionPlansDue() ? "amber" : "green"],
    ];
  }

  function renderRecapCards() {
    const color = { blue: "#2563eb", green: "#059669", amber: "#d97706", red: "#dc2626" };
    dom.recapGrid.innerHTML = recapValues().map(([label, value, tone]) => `
      <article class="metric shell-card rounded-2xl p-4" style="--accent:${color[tone] || color.blue}">
        <div class="text-2xl font-black text-slate-950">${safeHtml(value)}</div>
        <div class="text-xs uppercase tracking-[0.18em] text-slate-500 mt-1">${safeHtml(label)}</div>
      </article>
    `).join("");
  }

  function renderHistory() {
    dom.historyBox.innerHTML = state.exams.length
      ? table(["Date", "Joint", "Average", "Grade", "Position", "Schools"], state.exams.slice().reverse().map((e) => [e.examDate, e.jointName, fmt(e.socratesSummary?.average), e.socratesSummary?.grade, e.socratesSummary?.position, e.schools?.length || 0]))
      : "No uploaded joint has been analysed yet.";
  }

  function renderRecap() {
    const panel = $("panel-Recap");
    if (!state.latest) {
      panel.innerHTML = `<h2 class="text-xl font-black mb-2">No Joint Analysed Yet</h2><p class="text-slate-600">Upload an Excel result to generate the intelligence report.</p>`;
      return;
    }
    const analysis = buildAnalysis(state.latest, state.exams.filter((e) => e.examId !== state.latest.examId));
    panel.innerHTML = `
      <h2 class="text-2xl font-black text-slate-950 mb-2">${safeHtml(state.latest.jointName)}</h2>
      <p class="text-slate-500 mb-5">${safeHtml(state.latest.examDate)} • ${safeHtml(state.className)} • ${safeHtml(state.year)}</p>
      <div class="grid lg:grid-cols-2 gap-5">
        ${analysis.sections.map((s) => `<article class="rounded-2xl border border-slate-200 bg-white p-5"><h3 class="font-black text-slate-900 mb-2">${safeHtml(s.title)}</h3><p class="text-sm leading-6 text-slate-700">${safeHtml(s.body)}</p></article>`).join("")}
      </div>
    `;
  }

  function renderSchoolsPsle() {
    const panel = $("panel-Schools & PSLE Strength");
    const latest = state.latest;
    const rows = (latest?.schools || []).map((school) => {
      const rec = findPsleRecord(school.school || school.name);
      const cls = classifyPsle(rec?.average);
      return [school.school || school.name, fmt(school.average), school.grade || "-", school.position || "-", rec ? `${fmt(rec.average)} (${rec.year || "-"})` : "PSLE record not yet verified", cls];
    });
    panel.innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
        <div>
          <h2 class="text-xl font-black text-slate-950">Schools & PSLE Strength</h2>
          <p class="text-sm text-slate-500 mt-1">${latest ? safeHtml(competitionReading(latest).message) : "Upload a joint to assess competition strength."}</p>
        </div>
        <form id="psleForm" class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <input id="psleSchoolName" placeholder="School name / alias" class="rounded-xl border border-slate-300 px-3 py-2 text-sm" required>
          <input id="psleCode" placeholder="PSLE code" class="rounded-xl border border-slate-300 px-3 py-2 text-sm" required>
          <input id="psleAverage" type="number" step="0.01" placeholder="Average" class="rounded-xl border border-slate-300 px-3 py-2 text-sm" required>
          <button class="rounded-xl bg-slate-950 text-white px-3 py-2 text-sm font-black">Save PSLE</button>
          <input id="psleYear" placeholder="Year 2025/2024" class="rounded-xl border border-slate-300 px-3 py-2 text-sm" value="2025">
          <input id="psleGrade" placeholder="Grade" class="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <input id="psleCandidates" type="number" placeholder="Candidates" class="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <input id="psleSource" placeholder="Source URL" class="rounded-xl border border-slate-300 px-3 py-2 text-sm">
        </form>
      </div>
      <div class="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 p-3 mb-4 text-sm">Possible NECTA matches found must be confirmed manually before an alias is saved. Automatic NECTA lookup is reserved for a future Cloud Function.</div>
      ${table(["School", "Joint Avg", "Joint Grade", "Joint Pos", "PSLE record", "Strength"], rows)}
    `;
    $("psleForm").addEventListener("submit", savePsleRecord);
  }

  async function savePsleRecord(event) {
    event.preventDefault();
    const name = $("psleSchoolName").value.trim();
    const code = $("psleCode").value.trim();
    const year = $("psleYear").value.trim() || "2025";
    const payload = {
      officialName: name,
      code,
      year,
      candidates: num($("psleCandidates").value),
      average: num($("psleAverage").value),
      grade: $("psleGrade").value.trim(),
      sourceUrl: $("psleSource").value.trim(),
      confidence: "manual-confirmed",
      updatedBy: state.user.email || state.user.uid,
      updatedAt: Date.now(),
    };
    const updates = {};
    updates[legacyAwareRefPath(`psleSchoolRecords/${safeKey(code)}/years/${year}`)] = payload;
    updates[legacyAwareRefPath(`jointSchoolAliases/${normalizeKey(name)}`)] = {
      confirmedCode: safeKey(code),
      possibleMatches: [],
      confirmedBy: state.user.email || state.user.uid,
      confirmedAt: Date.now(),
    };
    await db().ref().update(updates);
    await loadPsleRecords();
    renderSchoolsPsle();
    showToast("PSLE record saved and alias confirmed.");
  }

  function findPsleRecord(schoolName) {
    const aliasKey = normalizeKey(schoolName);
    for (const codeBucket of Object.values(state.psleRecords || {})) {
      const years = codeBucket?.years || {};
      const rec = years["2025"] || years["2024"] || Object.values(years)[0];
      if (!rec) continue;
      if (normalizeKey(rec.officialName) === aliasKey || normalizeKey(rec.code) === aliasKey) return rec;
    }
    return null;
  }

  function classifyPsle(avg) {
    const n = Number(avg);
    if (!Number.isFinite(n)) return "Unknown";
    if (n >= 270) return "Elite";
    if (n >= 240) return "Strong";
    if (n >= 200) return "Medium";
    return "Weak";
  }

  function competitionReading(exam) {
    const schools = exam?.schools || [];
    const classes = schools.filter((s) => !isSocratesName(s.school || s.name)).map((s) => classifyPsle(findPsleRecord(s.school || s.name)?.average));
    const unknown = classes.filter((x) => x === "Unknown").length;
    const strong = classes.filter((x) => x === "Strong" || x === "Elite").length;
    const weak = classes.filter((x) => x === "Weak").length;
    if (!classes.length || unknown > classes.length / 2) return { label: "Unverified benchmark", message: "This joint has many unknown/new schools; benchmarking value is limited until PSLE records are confirmed." };
    if (strong >= classes.length / 2) return { label: "Strong benchmark", message: "This joint is a strong benchmark and should be taken seriously." };
    if (weak >= classes.length / 2) return { label: "Weak or comfort-zone benchmark", message: "Position alone is not enough; the strength of the field matters." };
    return { label: "Medium benchmark", message: "This is a medium benchmark; the result should be read with both position and PSLE strength in view." };
  }

  function renderSubjectAccountability() {
    const latest = state.latest;
    const rows = Object.values(latest?.subjectSummary || {}).map((s) => {
      const prev = state.previous?.subjectSummary?.[s.subject]?.average;
      const teachers = teacherNames(s.subject);
      const risk = riskStatus(s.average);
      return [s.subject, fmt(s.average), fmt(prev), movementText(s.average, prev), "40+", teachers, risk.label, (s.weakPupils || []).slice(0, 8).join(", "), subjectComment(s, prev)];
    });
    $("panel-Subject Accountability").innerHTML = `<h2 class="text-xl font-black text-slate-950 mb-4">Subject Accountability</h2>${table(["Subject", "Latest Avg", "Previous Avg", "Change", "Target", "Teacher(s)", "Risk", "Weak pupils", "Comment"], rows)}`;
  }

  function teacherNames(subject) {
    const teachers = state.teacherMap[subject] || [];
    if (!teachers.length) return UNMAPPED;
    return teachers.length > 1 ? teachers.map((t) => t.name).join(", ") + " (shared responsibility)" : teachers[0].name;
  }

  function riskStatus(avg) {
    const n = Number(avg);
    if (!Number.isFinite(n)) return { label: "Unknown", cls: "risk-warning" };
    if (n < 30) return { label: "Danger", cls: "risk-danger" };
    if (n < 35) return { label: "Not safe", cls: "risk-warning" };
    if (n < 40) return { label: "Improving but not yet A-safe", cls: "risk-warning" };
    return { label: "Safer, monitor", cls: "risk-safe" };
  }

  function subjectComment(s, prev) {
    const d = delta(prev, s.average);
    if (!Number.isFinite(d)) return "First tracked joint or previous subject data unavailable.";
    if (d > 0) return "Improvement must be acknowledged, but it must not deceive us; the next target remains 40+.";
    if (d < 0) return "Decline requires written explanation and immediate weekly recovery evidence.";
    return "No movement. Every week must show movement.";
  }

  function movementText(current, previous) {
    const d = delta(previous, current);
    return Number.isFinite(d) ? (d >= 0 ? "+" : "") + fmt(d) : "-";
  }

  function renderPupilMovement() {
    const rows = buildPupilMovement().map((m) => [m.name, m.adm, fmt(m.previous), fmt(m.current), movementText(m.current, m.previous), m.matchNote]);
    $("panel-Pupil Movement").innerHTML = `<h2 class="text-xl font-black text-slate-950 mb-4">Pupil Movement</h2>${table(["Pupil", "ADM", "Previous Avg", "Current Avg", "Change", "Match confidence"], rows)}`;
  }

  function buildPupilMovement() {
    const latest = state.latest?.pupils || [];
    const previous = state.previous?.pupils || [];
    return latest.map((p) => {
      const match = matchPreviousPupil(p, previous);
      return {
        name: pupilName(p),
        adm: p.adm || "",
        current: p.average,
        previous: match?.average ?? null,
        matchNote: match ? (match.matchType === "adm" ? "confirmed by admission/student ID" : "possible match - confirm identity") : "new or unmatched pupil",
      };
    });
  }

  function matchPreviousPupil(p, previous) {
    if (p.adm) {
      const hit = previous.find((x) => x.adm && normalizeKey(x.adm) === normalizeKey(p.adm));
      if (hit) return { ...hit, matchType: "adm" };
    }
    const pName = normalizeKey(pupilName(p));
    const hit = previous.find((x) => nameSimilarity(pName, normalizeKey(pupilName(x))) >= 0.82);
    return hit ? { ...hit, matchType: "name" } : null;
  }

  function nameSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const partsA = new Set(a.match(/[a-z]+/g) || []);
    const partsB = new Set(b.match(/[a-z]+/g) || []);
    const common = [...partsA].filter((x) => partsB.has(x)).length;
    return common / Math.max(partsA.size, partsB.size, 1);
  }

  function renderTeacherResponsibility() {
    const rows = Object.values(state.latest?.subjectSummary || {}).map((s) => [s.subject, teacherNames(s.subject), fmt(s.average), fmt(state.previous?.subjectSummary?.[s.subject]?.average), movementText(s.average, state.previous?.subjectSummary?.[s.subject]?.average), (s.weakPupils || []).length, requiredAction(s)]);
    $("panel-Teacher Responsibility").innerHTML = `<h2 class="text-xl font-black text-slate-950 mb-4">Teacher Responsibility</h2>${table(["Subject", "Teacher(s)", "Latest average", "Previous average", "Change", "Weak pupils", "Required action"], rows)}`;
  }

  function requiredAction(s) {
    const risk = riskStatus(s.average).label;
    if (risk === "Danger") return "Submit daily rescue plan and named weak-pupil intervention.";
    if (risk === "Not safe") return "Submit weekly topic correction and target movement plan.";
    return "Maintain target pressure and document weekly progress.";
  }

  function renderActionPlans() {
    const latest = state.latest;
    if (!latest) {
      $("panel-Action Plans").innerHTML = "Upload a joint before action plans can be created.";
      return;
    }
    $("panel-Action Plans").innerHTML = `
      <h2 class="text-xl font-black text-slate-950 mb-4">Action Plans</h2>
      <div class="space-y-4">
        ${Object.values(latest.subjectSummary || {}).map((s) => actionPlanForm(s)).join("")}
      </div>
    `;
    document.querySelectorAll("[data-save-action]").forEach((btn) => btn.addEventListener("click", () => saveActionPlan(btn.dataset.saveAction)));
  }

  function actionPlanForm(s) {
    const key = safeKey(s.subject);
    const plan = state.actionPlans[key] || {};
    return `
      <article class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-3">
          <div><h3 class="font-black">${safeHtml(s.subject)}</h3><p class="text-sm text-slate-500">${safeHtml(teacherNames(s.subject))} • Current average ${fmt(s.average)} • Target next joint 40+</p></div>
          <button data-save-action="${safeHtml(key)}" class="rounded-xl bg-slate-950 text-white px-4 py-2 text-sm font-black">Save Plan</button>
        </div>
        <div class="grid md:grid-cols-2 lg:grid-cols-5 gap-3">
          ${input(key, "teacherResponse", "Teacher response", plan.teacherResponse)}
          ${input(key, "weakTopics", "Weak topics", plan.weakTopics)}
          ${input(key, "weakPupils", "Weak pupils", plan.weakPupils || (s.weakPupils || []).join(", "))}
          ${input(key, "dailyPlan", "Daily plan", plan.dailyPlan)}
          ${input(key, "targetNextJoint", "Target next joint", plan.targetNextJoint || "40")}
        </div>
      </article>
    `;
  }

  function input(key, field, placeholder, value) {
    return `<textarea data-action-field="${safeHtml(key)}:${safeHtml(field)}" rows="3" placeholder="${safeHtml(placeholder)}" class="rounded-xl border border-slate-300 px-3 py-2 text-sm">${safeHtml(value || "")}</textarea>`;
  }

  async function saveActionPlan(subjectKey) {
    const payload = {};
    document.querySelectorAll("[data-action-field]").forEach((el) => {
      if (!String(el.dataset.actionField || "").startsWith(subjectKey + ":")) return;
      const field = el.dataset.actionField.split(":")[1];
      payload[field] = el.value.trim();
    });
    payload.submittedBy = state.user.email || state.user.uid;
    payload.submittedAt = Date.now();
    await ref(`jointExamActionPlans/${state.year}/${classKey()}/${state.latest.examId}/${subjectKey}`).set(payload);
    await loadActionPlans();
    renderAll();
    showToast("Action plan saved.");
  }

  function actionPlansDue() {
    const subjects = Object.keys(state.latest?.subjectSummary || {}).map(safeKey);
    return subjects.filter((s) => !state.actionPlans[s]?.submittedAt).length;
  }

  function renderPdfReports() {
    $("panel-PDF Reports").innerHTML = `
      <h2 class="text-xl font-black text-slate-950 mb-4">PDF Reports</h2>
      <div class="grid md:grid-cols-3 gap-4">
        ${pdfCard("Director's Internal Report", "Strong accountability report with teacher responsibility by subject.", "director")}
        ${pdfCard("Parent/School Committee Report", "Professional, calm, transparent report without shaming teachers.", "parent")}
        ${pdfCard("Teacher Subject Report", "Subject-specific action report for accountability follow-up.", "teacher")}
      </div>
    `;
    document.querySelectorAll("[data-pdf]").forEach((btn) => btn.addEventListener("click", () => generatePdf(btn.dataset.pdf)));
  }

  function pdfCard(title, body, type) {
    return `<article class="rounded-2xl border border-slate-200 bg-white p-5"><h3 class="font-black text-slate-950">${safeHtml(title)}</h3><p class="text-sm text-slate-500 my-3">${safeHtml(body)}</p><button data-pdf="${safeHtml(type)}" class="rounded-xl bg-slate-950 text-white px-4 py-3 font-black w-full">Generate PDF</button></article>`;
  }

  function buildAnalysis(exam, previousExams) {
    const prev = previousExams?.slice().sort(compareExamDate).pop();
    const comp = competitionReading(exam);
    const avgChange = prev ? delta(prev.socratesSummary?.average, exam.socratesSummary?.average) : null;
    const posText = prev ? positionReading(exam, prev) : "This is the first uploaded joint for this class and year, so trend judgement is limited.";
    const weakSubjects = Object.values(exam.subjectSummary || {}).filter((s) => Number(s.average) < 35).map((s) => s.subject);
    const best = Object.values(exam.subjectSummary || {}).slice().sort((a, b) => Number(b.average) - Number(a.average))[0];
    const worst = Object.values(exam.subjectSummary || {}).slice().sort((a, b) => Number(a.average) - Number(b.average))[0];
    const dangerPupils = (exam.pupils || []).filter((p) => Number(p.average) < 30).map(pupilName);
    const subjectLines = Object.values(exam.subjectSummary || {}).map((s) => `${s.subject}: average ${fmt(s.average)}, teacher(s): ${teacherNames(s.subject)}, weak pupils ${(s.weakPupils || []).length}`).join("; ");
    return {
      sections: [
        { title: "Executive Position", body: `Socrates is the key school in this internal accountability report. The latest average is ${fmt(exam.socratesSummary?.average)}, grade ${exam.socratesSummary?.grade || "-"}, position ${exam.socratesSummary?.position || "-"} out of ${exam.schools?.length || "-"} schools. The improvement must be acknowledged, but it must not deceive us. Position alone is not enough; the strength of the field matters.` },
        { title: "Evidence from PSLE Records", body: comp.message },
        { title: "Joint Examination Comparison", body: prev ? `${posText} Average movement from previous joint is ${movementText(exam.socratesSummary?.average, prev.socratesSummary?.average)}. Every week must show movement.` : "No previous joint is available yet for comparison. The next upload will activate previous-to-current and first-to-current trend analysis." },
        { title: "Subject-by-Subject Accountability", body: weakSubjects.length ? `Risk subjects requiring written answers: ${weakSubjects.join(", ")}. A subject teacher should not hide behind the class average. Every subject must have a target. ${subjectLines}` : `No subject is below the immediate risk threshold, but every subject must still defend movement towards 40+. ${subjectLines}` },
        { title: "Latest School Performance Table", body: `The latest joint contains ${exam.schools?.length || 0} participating schools. Socrates must be read against both its position and the verified strength of the participating schools.` },
        { title: "Previous Joint Performance Table", body: prev ? `Previous joint used for comparison: ${prev.jointName || "Unnamed joint"} dated ${prev.examDate || "-"}, average ${fmt(prev.socratesSummary?.average)}, grade ${prev.socratesSummary?.grade || "-"}, position ${prev.socratesSummary?.position || "-"}.` : "No previous joint has been uploaded for this class and year." },
        { title: "Individual Socrates Pupils", body: `Every weak pupil must be known by name. Pupils below average 30: ${dangerPupils.join(", ") || "none detected from uploaded table"}. Best subject currently appears to be ${best?.subject || "-"}; weakest subject currently appears to be ${worst?.subject || "-"}.` },
        { title: "Pupil Movement", body: prev ? "Pupil movement uses admission/student ID where available. Name-only matches are marked as possible match - confirm identity, because the system must not create false certainty." : "Pupil movement will activate after the second joint upload for this class and year." },
        { title: "Questions Requiring Written Answers from Teachers", body: "Each responsible teacher must answer: Which pupils are below target by name? Which topics caused the loss? What daily correction will happen? What target will be reached by the next joint? What weekly evidence will management inspect?" },
        { title: "Required Immediate Action Plan", body: "Every subject must have a target. Every week must show movement. Danger subjects require daily rescue work; not-safe subjects require weekly topic correction and named pupil follow-up." },
        { title: "Parents and School Committee Involvement", body: "Parents and the school committee should receive calm, factual communication on class movement, attendance of weak pupils, remedial expectations, and school-level support required. The communication should not shame individual teachers." },
        { title: "Director's Closing Position", body: `If we fail to act now, we should not wait for PSLE results to ask what went wrong. Required action plans must convert this joint into weekly evidence, named interventions, and measurable subject targets.` },
        { title: "Appendix: Sources / Uploaded Files / PSLE Records Used", body: `Excel source: ${exam.sourceFileName || "-"}. PDF evidence: ${exam.pdfEvidenceUrlOrName || "not attached"}. PSLE records are manual-confirmed in this version; uncertain or missing matches remain clearly marked.` },
      ],
      avgChange,
      competition: comp,
    };
  }

  function positionReading(current, previous) {
    const c = Number(current.socratesSummary?.position);
    const p = Number(previous.socratesSummary?.position);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return "Position comparison is unavailable because one result has no numeric position.";
    if (c < p) return "Socrates improved in position, but the competition field must still be verified before celebrating.";
    if (c > p) return "Socrates declined in position; if the field was weaker, this is more serious.";
    return "Socrates held the same position; management should now judge subject movement and pupil movement.";
  }

  function subjectMovement() {
    if (!state.latest || !state.previous) return {};
    const moves = Object.values(state.latest.subjectSummary || {}).map((s) => ({ subject: s.subject, change: delta(state.previous.subjectSummary?.[s.subject]?.average, s.average) })).filter((m) => Number.isFinite(m.change));
    moves.sort((a, b) => b.change - a.change);
    return { best: moves[0] || null, worst: moves[moves.length - 1] || null };
  }

  async function generatePdf(type) {
    if (!state.latest) return showToast("Upload a joint before generating a PDF.");
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) return showToast("jsPDF is not loaded.");
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const margin = 14;
    let y = 16;
    if (state.schoolLogoDataUrl) doc.addImage(state.schoolLogoDataUrl, "PNG", margin, y, 18, 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(reportTitle(type), margin + 23, y + 7);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${state.schoolName} • ${state.className} • ${state.year} • ${state.latest.examDate || ""}`, margin + 23, y + 13);
    y += 28;
    const analysis = buildAnalysis(state.latest, state.exams.filter((e) => e.examId !== state.latest.examId));
    const sections = type === "parent" ? analysis.sections.filter((s) => !/Teacher|Subject-by-Subject/.test(s.title)) : analysis.sections;
    sections.forEach((section) => {
      y = ensurePage(doc, y, 45);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(section.title, margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(section.body, 180);
      doc.text(lines, margin, y);
      y += lines.length * 5 + 5;
    });
    addPdfTable(doc, "Latest School Performance Table", ["School", "Avg", "Grade", "Pos"], (state.latest.schools || []).map((s) => [s.school || s.name, fmt(s.average), s.grade || "-", s.position || "-"]));
    addPdfTable(doc, "Subject Accountability", ["Subject", "Teacher(s)", "Avg", "Risk", "Weak pupils"], Object.values(state.latest.subjectSummary || {}).map((s) => [s.subject, type === "parent" ? "School academic team" : teacherNames(s.subject), fmt(s.average), riskStatus(s.average).label, String((s.weakPupils || []).length)]));
    if (type !== "parent") {
      addPdfTable(doc, "Teacher Questions Requiring Written Answers", ["Subject", "Question"], Object.values(state.latest.subjectSummary || {}).map((s) => [s.subject, `What weekly evidence will move ${s.subject} from ${fmt(s.average)} to 40+ before the next joint?`]));
    }
    addPdfTable(doc, "Individual Socrates Pupils", ["Pupil", "ADM", "Average", "Grade"], (state.latest.pupils || []).map((p) => [pupilName(p), p.adm || "", fmt(p.average), p.grade || ""]));
    addPdfTable(doc, "Appendix: Sources / Warnings", ["Item", "Detail"], [
      ["Source Excel", state.latest.sourceFileName || ""],
      ["PDF Evidence", state.latest.pdfEvidenceUrlOrName || "No PDF evidence attached"],
      ["PSLE confidence", "Manual records only unless a future NECTA Cloud Function is added."],
      ["Warnings", (state.latest.warnings || []).join("; ") || "No parser warnings recorded."],
    ]);
    addPageNumbers(doc);
    doc.save(`${type}_joint_exam_report_${state.className.replace(/\s+/g, "_")}_${state.year}.pdf`);
  }

  function reportTitle(type) {
    if (type === "parent") return "Parent / School Committee Joint Exam Report";
    if (type === "teacher") return "Teacher Subject Joint Exam Action Report";
    return "Director's Internal Joint Exam Intelligence Report";
  }

  function ensurePage(doc, y, needed) {
    if (y + needed < 285) return y;
    doc.addPage();
    return 16;
  }

  function addPdfTable(doc, title, headers, rows) {
    const startY = (doc.lastAutoTable?.finalY || 0) + 10;
    const y = startY > 20 ? ensurePage(doc, startY, 50) : ensurePage(doc, 16, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, 14, y);
    doc.autoTable({
      head: [headers],
      body: rows,
      startY: y + 4,
      styles: { fontSize: 8, cellPadding: 2.2 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 248, 252] },
      margin: { left: 14, right: 14 },
    });
  }

  function addPageNumbers(doc) {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Page ${i} of ${pages}`, 180, 290);
    }
  }

  function loadImageDataUrl(url) {
    return fetch(url).then((r) => r.blob()).then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
  }
})();
