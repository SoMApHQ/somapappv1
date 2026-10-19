// Socrates Class 7 -> Preform One auto-join
// Socrates pupils finish their primary exams around 9 September, so from
// 10 September each year every Socrates Class 7 pupil is added to that year's
// Preform One file. They stay in the main portal untouched; this only adds a
// Preform One record. They do not pay the Preform One fee: totalFee is 0 and the
// payment category is "SOCRATES".
//
// Data is read from Socrates' own paths (legacy root + schools/socrates-school),
// never from the browser's ambient school context, so another school's pupils
// can never leak in. Class resolution mirrors shared/finance_math.js.
// The sync is additive only: existing Preform One records (payments, attendance,
// scores) are never overwritten, and a pupil deleted from Preform One is
// remembered under socratesClass7Excluded so the sync does not re-add them.
(function (global) {
  const PREFONE_ROOT = '/schools/Socrates School Preform one';
  const SOCRATES_ID = 'socrates-school';
  const FIRST_YEAR = 2026;          // feature starts with the 2026 intake
  const JOIN_MONTH = 8;             // September (0-based)
  const JOIN_DAY = 10;
  const ANCHOR_YEAR = 2025;
  const SESSION_KEY = 'prefone_socrates_join_synced_';
  const CLASS_ORDER = ['Baby Class', 'Middle Class', 'Pre Unit Class', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7'];
  const CLASS_ALIASES = {
    'middle': 'Middle Class', 'middle class': 'Middle Class', 'pre-primary': 'Middle Class', 'pre primary': 'Middle Class',
    'pre unit': 'Pre Unit Class', 'pre-unit': 'Pre Unit Class', 'preunit': 'Pre Unit Class',
    'preunit class': 'Pre Unit Class', 'pre unit class': 'Pre Unit Class'
  };
  const L = (s) => String(s || '').trim().toLowerCase();
  const normalizeClassLabel = (label) => CLASS_ALIASES[L(label)] || label;
  const pad = (n) => String(n).padStart(2, '0');

  function shiftClass(baseClass, delta) {
    const i = CLASS_ORDER.findIndex((c) => L(c) === L(normalizeClassLabel(baseClass)));
    if (i < 0) return baseClass || '';
    const j = i + Number(delta || 0);
    if (j < 0) return 'PRE-ADMISSION';
    if (j >= CLASS_ORDER.length) return 'GRADUATED';
    return CLASS_ORDER[j];
  }

  function toMs(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 1e10) return value;
      if (value > 1e9) return value * 1000;
      return value;
    }
    const s = String(value).trim();
    if (!s) return null;
    const auto = s.match(/^AUTO-(\d{10,13})$/i);
    const digits = auto ? auto[1] : (/^\d{10,13}$/.test(s) ? s : null);
    if (digits) {
      const n = Number(digits);
      return n > 1e12 ? n : n * 1000;
    }
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function registrationMs(stu) {
    return toMs(stu.timestamp) ?? toMs(stu.createdAt) ?? toMs(stu.registeredAt) ?? toMs(stu.regTimestamp) ??
      toMs(stu.dateRegistered) ?? toMs(stu.dateOfRegistration) ?? toMs(stu.id) ?? toMs(stu.studentId) ??
      toMs(stu.admissionNumber) ?? toMs(stu.admissionNo) ?? null;
  }

  function registrationYear(stu) {
    const explicit = Number(stu.academicYear || stu.admissionYear || stu.admYear || stu.year);
    if (Number.isFinite(explicit) && explicit) return explicit;
    const ms = registrationMs(stu);
    return ms ? new Date(ms).getFullYear() : null;
  }

  function isActiveSocratesPupil(stu) {
    if (!stu || typeof stu !== 'object') return false;
    const status = L(stu.status);
    if (stu.deleted === true || stu.isDeleted === true || stu.archived === true || stu.isArchived === true ||
        stu.removed === true || stu.isRemoved === true || stu.active === false || stu.isGraduated === true) return false;
    if (['deleted', 'archived', 'removed', 'shifted', 'graduated'].includes(status)) return false;
    const sid = String(stu.schoolId || stu.schoolID || stu.school_id || stu.currentSchoolId || stu.ownerSchoolId || stu.meta?.schoolId || '').trim();
    if (sid && L(sid).replace(/_/g, '-') !== SOCRATES_ID) return false;
    const sname = L(stu.schoolName || stu.school || stu.schoolBranch || stu.campusName || stu.meta?.schoolName);
    if (sname && !/socrates/.test(sname)) return false;
    if (!sid && !sname) {
      const ms = registrationMs(stu);
      if (Number.isFinite(ms) && ms >= Date.UTC(2026, 6, 1)) return false; // unmarked post-split record: not provably Socrates
    }
    const bad = (v) => !String(v || '').trim() || ['n/a', 'na'].includes(L(v));
    return !bad(stu.admissionNumber) && !bad(stu.firstName) && !bad(stu.lastName);
  }

  function classForYear(id, stu, year, yearEnrollments, anchorEnrollments) {
    const enrollment = yearEnrollments[id] || {};
    const hasEnrollment = enrollment && typeof enrollment === 'object' && Object.keys(enrollment).length > 0;
    if (hasEnrollment) return shiftClass(enrollment.className || enrollment.classLevel || enrollment.class || '', 0);
    const anchor = anchorEnrollments[id] || {};
    const base = stu.classLevel || stu.class || anchor.className || anchor.classLevel || anchor.class || '';
    const regYear = registrationYear(stu);
    return shiftClass(base, regYear ? year - regYear : 0);
  }

  function joinDate(year) {
    return new Date(year, JOIN_MONTH, JOIN_DAY);
  }

  function isJoinOpen(year, now = new Date()) {
    const y = Number(year);
    return Number.isFinite(y) && y >= FIRST_YEAR && now >= joinDate(y);
  }

  function normalizePhone(raw) {
    const digits = String(raw || '').replace(/[^\d+]/g, '');
    if (/^\+255[67]\d{8}$/.test(digits)) return digits;
    if (/^255[67]\d{8}$/.test(digits)) return `+${digits}`;
    if (/^0[67]\d{8}$/.test(digits)) return `+255${digits.slice(1)}`;
    if (/^[67]\d{8}$/.test(digits)) return `+255${digits}`;
    return String(raw || '').trim();
  }

  const safeKey = (value) => String(value || '').trim().replace(/[.#$\[\]\/]/g, '-');

  async function readSocratesClass7(db, year) {
    const read = (path) => db.ref(path).once('value').then((snap) => snap.val() || {}).catch(() => ({}));
    const scoped = (path) => `schools/${SOCRATES_ID}/${path}`;
    const [rootStudents, scopedStudents, rootAnchor, scopedAnchor, rootYear, scopedYear] = await Promise.all([
      read('students'), read(scoped('students')),
      read(`enrollments/${ANCHOR_YEAR}`), read(scoped(`enrollments/${ANCHOR_YEAR}`)),
      read(`enrollments/${year}`), read(scoped(`enrollments/${year}`))
    ]);
    const students = { ...rootStudents, ...scopedStudents };
    const anchorEnrollments = { ...rootAnchor, ...scopedAnchor };
    const yearEnrollments = { ...rootYear, ...scopedYear };
    return Object.entries(students).filter(([id, stu]) => {
      if (!isActiveSocratesPupil(stu)) return false;
      const regYear = registrationYear(stu);
      if (regYear && regYear > year) return false;
      return classForYear(id, stu, year, yearEnrollments, anchorEnrollments) === 'Class 7';
    });
  }

  function buildPrefonePayload(id, stu, year) {
    const parentName = stu.primaryParentName || stu.parentName || stu.guardianName || stu.secondaryGuardian || '';
    const parentContact = normalizePhone(stu.primaryParentContact || stu.parentPhone || stu.guardianPhone || stu.contact || '');
    return {
      firstName: String(stu.firstName || '').trim(),
      middleName: String(stu.middleName || '').trim(),
      lastName: String(stu.lastName || '').trim(),
      gender: stu.gender || stu.sex || '',
      dob: stu.dob || stu.dateOfBirth || '',
      reportingDate: `${year}-${pad(JOIN_MONTH + 1)}-${pad(JOIN_DAY)}`,
      formerSchool: 'SOCRATES',
      parentContact,
      parentName,
      photoUrl: stu.passportPhotoUrl || stu.passportPhotoURL || stu.photoUrl || '',
      totalFee: 0,
      feeCategory: 'SOCRATES',
      payments: [],
      attendance: [],
      scores: [],
      shifted: false,
      registrationDate: new Date().toISOString().split('T')[0],
      school: 'Socrates School Preform One',
      source: 'socrates-class7',
      socratesStudentKey: id,
      socratesAdmissionNumber: String(stu.admissionNumber || stu.admissionNo || '').trim(),
      autoJoinedAt: Date.now()
    };
  }

  // Adds missing Socrates Class 7 pupils to Preform One for `year`.
  // Returns { added, skipped, open } and never throws.
  async function syncSocratesClass7(db, year, options = {}) {
    const y = Number(year);
    const result = { added: 0, skipped: 0, open: isJoinOpen(y) };
    if (!db || !result.open) return result;
    const sessionKey = SESSION_KEY + y;
    try {
      if (!options.force && sessionStorage.getItem(sessionKey) === '1') return result;
    } catch (_) { /* storage blocked */ }
    try {
      const base = `${PREFONE_ROOT}/${y}`;
      const [pupils, existingSnap, excludedSnap] = await Promise.all([
        readSocratesClass7(db, y),
        db.ref(`${base}/students`).once('value'),
        db.ref(`${base}/socratesClass7Excluded`).once('value')
      ]);
      const existing = existingSnap.val() || {};
      const excluded = excludedSnap.val() || {};
      const joinedKeys = new Set(Object.values(existing).map((s) => s && s.socratesStudentKey).filter(Boolean));
      for (const [id, stu] of pupils) {
        if (joinedKeys.has(id) || excluded[id]) { result.skipped += 1; continue; }
        const key = safeKey(stu.admissionNumber || stu.admissionNo) || safeKey(id);
        const payload = buildPrefonePayload(id, stu, y);
        const tx = await db.ref(`${base}/students/${key}`).transaction((current) => (current === null ? payload : undefined));
        if (tx.committed) result.added += 1; else result.skipped += 1;
      }
      try { sessionStorage.setItem(sessionKey, '1'); } catch (_) { /* storage blocked */ }
    } catch (err) {
      console.warn('Socrates Class 7 -> Preform One sync failed', err);
    }
    return result;
  }

  // Called when a Preform One record is deleted so the sync does not re-add it.
  function rememberExclusion(db, year, student) {
    const id = student && student.socratesStudentKey;
    if (!db || !id) return Promise.resolve();
    return db.ref(`${PREFONE_ROOT}/${year}/socratesClass7Excluded/${id}`).set({
      admissionNumber: student.socratesAdmissionNumber || '',
      name: [student.firstName, student.lastName].filter(Boolean).join(' '),
      excludedAt: Date.now()
    });
  }

  global.PrefoneSocratesJoin = { syncSocratesClass7, rememberExclusion, isJoinOpen, readSocratesClass7 };
})(typeof window !== 'undefined' ? window : globalThis);
