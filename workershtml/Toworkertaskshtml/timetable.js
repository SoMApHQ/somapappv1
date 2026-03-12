(() => {
  'use strict';

  const TZ = 'Africa/Nairobi';
  const FALLBACK_LOGO = '../../images/somap-logo.png.jpg';
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const GROUPS = {
    nursery_group: {
      id: 'nursery_group',
      title: 'Baby Class + Middle Class + Pre-Unit',
      classes: ['Baby Class', 'Middle Class', 'Pre-Unit']
    },
    lower_primary_group: {
      id: 'lower_primary_group',
      title: 'Class 1 + Class 2',
      classes: ['Class 1', 'Class 2']
    },
    upper_primary_group: {
      id: 'upper_primary_group',
      title: 'Class 3 + Class 4 + Class 5 + Class 6 + Class 7',
      classes: ['Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7']
    }
  };
  const GROUP_ORDER = Object.keys(GROUPS);
  const MANAGEMENT_ROLES = new Set(['head teacher', 'assistant headteacher', 'management teacher', 'academic teacher']);
  const SUBJECT_DEFAULTS = {
    'Baby Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
    'Middle Class': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
    'Pre-Unit': ['Arithmetic', 'Communication', 'Relation', 'CRN', 'Health Care', 'Arts'],
    'Class 1': ['Writing Skills', 'Arithmetic', 'Developing Sports & Arts', 'Health Care', 'Kusoma', 'Listening'],
    'Class 2': ['Writing Skills', 'Reading Skills', 'Arithmetic', 'Developing Sports & Arts', 'Health Care', 'Kusoma', 'Listening'],
    'Class 3': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
    'Class 4': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
    'Class 5': ['Math', 'English', 'Kiswahili', 'Science', 'Geography', 'Arts', 'History', 'French'],
    'Class 6': ['Math', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Civics & Morals'],
    'Class 7': ['Math', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Civics & Morals']
  };
  const DEFAULT_ABBREVIATIONS = {
    Math: 'MATH',
    English: 'ENGL',
    Kiswahili: 'KISW',
    Science: 'SCIE',
    Geography: 'GEO',
    History: 'HIST',
    French: 'FR',
    'Social Studies': 'SST',
    'Civics & Morals': 'CME',
    Arithmetic: 'ARITH',
    Communication: 'COMM',
    Relation: 'REL',
    CRN: 'CRN',
    'Health Care': 'HCARE',
    Arts: 'ARTS',
    'Writing Skills': 'WS',
    'Reading Skills': 'RS',
    Listening: 'LIST',
    Kusoma: 'KSM',
    'Developing Sports & Arts': 'DSA'
  };
  const DEFAULT_SUBJECT_COLORS = {
    Math: '#dceafe',
    English: '#fce7f3',
    Kiswahili: '#dcfce7',
    Science: '#fef3c7',
    Geography: '#fae8ff',
    History: '#fee2e2',
    French: '#cffafe',
    'Social Studies': '#fef3c7',
    'Civics & Morals': '#fde68a',
    Arithmetic: '#dbeafe',
    Communication: '#ede9fe',
    Relation: '#fce7f3',
    CRN: '#ffe4e6',
    'Health Care': '#dcfce7',
    Arts: '#ffedd5',
    'Writing Skills': '#e0f2fe',
    'Reading Skills': '#fef9c3',
    Listening: '#ede9fe',
    Kusoma: '#cffafe',
    'Developing Sports & Arts': '#ffedd5'
  };
  const CORE_SUBJECTS = new Set(['Math', 'English', 'Kiswahili', 'Science', 'Arithmetic', 'Writing Skills', 'Reading Skills', 'Communication', 'Kusoma']);
  const MORNING_PRIORITY_SUBJECTS = new Set(['Math', 'English', 'Science']);
  const DEFAULT_SLOT_PRESETS = {
    nursery_group: [
      { id: 'nursery_1', start: '08:00', end: '08:40', label: 'Teaching 1', isTeaching: true },
      { id: 'nursery_2', start: '08:40', end: '09:20', label: 'Teaching 2', isTeaching: true },
      { id: 'nursery_break', start: '09:20', end: '09:50', label: 'Play / Break', isTeaching: false },
      { id: 'nursery_3', start: '09:50', end: '10:30', label: 'Teaching 3', isTeaching: true },
      { id: 'nursery_4', start: '10:30', end: '11:10', label: 'Teaching 4', isTeaching: true },
      { id: 'nursery_lunch', start: '11:10', end: '11:50', label: 'Lunch / Rest', isTeaching: false },
      { id: 'nursery_5', start: '11:50', end: '12:30', label: 'Teaching 5', isTeaching: true },
      { id: 'nursery_6', start: '12:30', end: '13:10', label: 'Games / Story', isTeaching: false }
    ],
    lower_primary_group: [
      { id: 'lower_1', start: '08:00', end: '08:50', label: 'Teaching 1', isTeaching: true },
      { id: 'lower_2', start: '08:50', end: '09:40', label: 'Teaching 2', isTeaching: true },
      { id: 'lower_break', start: '09:40', end: '10:10', label: 'Breakfast / Break', isTeaching: false },
      { id: 'lower_3', start: '10:10', end: '11:00', label: 'Teaching 3', isTeaching: true },
      { id: 'lower_4', start: '11:00', end: '11:50', label: 'Teaching 4', isTeaching: true },
      { id: 'lower_lunch', start: '11:50', end: '12:30', label: 'Lunch', isTeaching: false },
      { id: 'lower_5', start: '12:30', end: '13:20', label: 'Teaching 5', isTeaching: true },
      { id: 'lower_6', start: '13:20', end: '14:10', label: 'Teaching 6', isTeaching: true }
    ],
    upper_primary_group: [
      { id: 'upper_1', start: '08:00', end: '09:00', label: 'Teaching 1', isTeaching: true },
      { id: 'upper_2', start: '09:00', end: '10:00', label: 'Teaching 2', isTeaching: true },
      { id: 'upper_break', start: '10:00', end: '10:30', label: 'Breakfast / Break', isTeaching: false },
      { id: 'upper_3', start: '10:30', end: '11:30', label: 'Teaching 3', isTeaching: true },
      { id: 'upper_4', start: '11:30', end: '12:30', label: 'Teaching 4', isTeaching: true },
      { id: 'upper_lunch', start: '12:30', end: '13:10', label: 'Lunch', isTeaching: false },
      { id: 'upper_5', start: '13:10', end: '14:00', label: 'Teaching 5', isTeaching: true },
      { id: 'upper_6', start: '14:00', end: '15:00', label: 'Teaching 6', isTeaching: true }
    ]
  };
  const DEFAULT_PERIOD_PRESETS = {
    nursery_group: { default: 3, special: { Arithmetic: 4, Communication: 4, Relation: 3, CRN: 2, 'Health Care': 2, Arts: 2 } },
    lower_primary_group: { default: 3, special: { 'Writing Skills': 4, 'Reading Skills': 4, Arithmetic: 5, Listening: 2, Kusoma: 3, 'Developing Sports & Arts': 2, 'Health Care': 2 } },
    upper_primary_group: { default: 2, special: { Math: 5, English: 5, Kiswahili: 4, Science: 4, Geography: 2, History: 2, French: 2, Arts: 2, 'Social Studies': 3, 'Civics & Morals': 2 } }
  };

  const state = {
    db: null,
    school: null,
    schoolId: '',
    year: '',
    workerId: '',
    viewer: { profile: {}, role: 'Teacher', normalizedRole: 'teacher', canManage: false, name: '' },
    teachers: [],
    teacherMap: {},
    subjectCatalog: {},
    schemeHoursByClass: {},
    settingsByGroup: {},
    generatedByGroup: {},
    previewByGroup: {},
    sourceConfigHash: '',
    activeGroupId: GROUP_ORDER[0],
    activeTab: 'overview',
    lastDownloadedAt: '',
    watchers: [],
    refreshTimer: null,
    autoGenerating: false,
    dirtySettings: new Set(),
    schoolLogoUrl: FALLBACK_LOGO
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    bindStaticUi();
    if (!ensureDeps()) return;
    state.db = firebase.database();
    syncContextFromQuery();
    state.school = window.SOMAP.getSchool();
    state.schoolId = state.school?.id || 'socrates-school';
    state.year = normalizeYear(window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear());
    state.workerId = resolveWorkerId();
    populateGroupSelector();
    initBackLink();
    initYearBinding();
    reloadAll({ reason: 'init', withAutoGenerate: true }).catch((error) => {
      console.error('Timetable init failed', error);
      toast('Unable to load timetable module.', 'error');
    });
  }

  function cacheElements() {
    [
      'backToTasks', 'schoolNameDisplay', 'currentYearLabel', 'school-logo-display', 'generatedStatusBadge',
      'collisionStatusBadge', 'accessBadge', 'lastGeneratedValue', 'lastDownloadedValue', 'groupSelect', 'yearSelect',
      'refreshButton', 'regenerateButton', 'generateAllButton', 'downloadPdfButton', 'downloadAllPdfButton',
      'printButton', 'alertStack', 'summaryTeachers', 'summaryTeachersFoot', 'summaryClasses', 'summaryClassesFoot',
      'summarySubjects', 'summarySubjectsFoot', 'summaryPeriods', 'summaryPeriodsFoot', 'summaryCollisions',
      'summaryCollisionsFoot', 'summaryValidation', 'summaryValidationFoot', 'overviewStatusChip', 'overviewHighlights',
      'validationSummaryPanel', 'validationDetails', 'teacherClassFilter', 'teacherTableBody', 'settingsStatusChip',
      'saveSettingsButton', 'addSlotButton', 'resetSlotsButton', 'slotEditor', 'periodRequirementsEditor',
      'subjectOptionsEditor', 'lockedCellsEditor', 'previewStatusChip', 'previewGenerateButton', 'saveDraftInvalidButton',
      'previewShell', 'pdfMetaPanel', 'printNotesPanel', 'pdfCurrentButton', 'pdfAllButton', 'pdfPrintButton'
    ].forEach((id) => {
      els[toCamel(id)] = document.getElementById(id);
    });
  }

  function bindStaticUi() {
    document.querySelectorAll('.tt-tab').forEach((tabButton) => {
      tabButton.addEventListener('click', () => setActiveTab(tabButton.dataset.tab || 'overview'));
    });
    els.groupSelect?.addEventListener('change', () => {
      state.activeGroupId = els.groupSelect.value || GROUP_ORDER[0];
      renderAll();
      maybeAutoRegenerateCurrent('group-switch').catch((error) => console.warn('Auto-regeneration on group switch failed', error));
    });
    els.teacherClassFilter?.addEventListener('change', renderTeacherTable);
    els.refreshButton?.addEventListener('click', () => reloadAll({ reason: 'manual-refresh', withAutoGenerate: true }));
    els.regenerateButton?.addEventListener('click', () => generateGroup(state.activeGroupId, { saveMode: 'validOnly', silent: false, openPreview: true }));
    els.previewGenerateButton?.addEventListener('click', () => generateGroup(state.activeGroupId, { saveMode: 'validOnly', silent: false, openPreview: true }));
    els.generateAllButton?.addEventListener('click', () => generateAllGroups({ saveMode: 'validOnly', silent: false }));
    els.saveSettingsButton?.addEventListener('click', saveCurrentSettings);
    els.addSlotButton?.addEventListener('click', () => {
      mutateSettings((settings) => {
        settings.slots.push({ id: `slot_${Date.now()}`, start: '08:00', end: '08:40', label: 'New Slot', isTeaching: true });
      });
    });
    els.resetSlotsButton?.addEventListener('click', () => {
      mutateSettings((settings) => {
        settings.slots = deepClone(DEFAULT_SLOT_PRESETS[state.activeGroupId] || []);
      });
    });
    els.saveDraftInvalidButton?.addEventListener('click', () => saveDraftInvalid(state.activeGroupId));
    els.downloadPdfButton?.addEventListener('click', () => downloadCurrentGroupPdf());
    els.downloadAllPdfButton?.addEventListener('click', () => downloadAllGroupsPdf());
    els.printButton?.addEventListener('click', printCurrentPreview);
    els.pdfCurrentButton?.addEventListener('click', () => downloadCurrentGroupPdf());
    els.pdfAllButton?.addEventListener('click', () => downloadAllGroupsPdf());
    els.pdfPrintButton?.addEventListener('click', printCurrentPreview);
  }

  function initBackLink() {
    const schoolId = state.schoolId || (window.SOMAP?.getSchoolId?.() || 'socrates-school');
    const year = normalizeYear(window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear());
    if (els.backToTasks) {
      els.backToTasks.href = `../workertasks.html?school=${encodeURIComponent(schoolId)}&year=${encodeURIComponent(year)}`;
    }
  }

  function initYearBinding() {
    if (window.somapYearContext?.attachYearDropdown && els.yearSelect) {
      window.somapYearContext.attachYearDropdown(els.yearSelect);
      els.yearSelect.value = state.year;
    }
    if (window.somapYearContext?.onYearChanged) {
      window.somapYearContext.onYearChanged((selectedYear) => {
        const nextYear = normalizeYear(selectedYear);
        if (nextYear === state.year) return;
        state.year = nextYear;
        reloadAll({ reason: 'year-change', withAutoGenerate: true }).catch((error) => {
          console.error('Year reload failed', error);
          toast('Unable to reload timetable for the selected year.', 'error');
        });
      });
    }
  }

  function ensureDeps() {
    if (!window.firebase || !firebase.apps?.length) {
      toast('Firebase is not ready on this page.', 'error');
      return false;
    }
    if (!window.SOMAP || typeof SOMAP.getSchool !== 'function' || typeof SOMAP.P !== 'function') {
      toast('School context is missing.', 'error');
      return false;
    }
    return true;
  }

  function syncContextFromQuery() {
    const params = new URLSearchParams(window.location.search || '');
    const schoolId = params.get('school');
    const year = params.get('year');
    if (schoolId && window.SOMAP?.setSchoolId) {
      window.SOMAP.setSchoolId(schoolId);
    }
    if (year && window.somapYearContext?.setSelectedYear) {
      window.somapYearContext.setSelectedYear(normalizeYear(year), { manual: false, forceDispatch: true });
    }
  }

  async function reloadAll({ reason = 'refresh', withAutoGenerate = false } = {}) {
    setBusyStatus(`Loading ${reason.replace(/-/g, ' ')}...`);
    detachWatchers();
    state.previewByGroup = {};
    state.dirtySettings.clear();
    state.viewer = await loadViewerContext();
    await loadSchoolBranding();
    const source = await loadTeacherSources();
    state.teachers = source.teachers;
    state.teacherMap = indexBy(source.teachers, 'workerId');
    state.subjectCatalog = source.subjectCatalog;
    state.schemeHoursByClass = await loadSchemeHoursMap();
    state.sourceConfigHash = buildSourceConfigHash(source);
    await loadTimetableRecords();
    ensureSettingsShape();
    subscribeToSourceChanges();
    renderAll();
    if (withAutoGenerate) {
      await maybeAutoRegenerateAll('source-refresh');
    } else {
      await maybeAutoRegenerateCurrent('render-only');
    }
    setBusyStatus('');
  }

  async function loadViewerContext() {
    const workerId = state.workerId || resolveWorkerId();
    const year = state.year;
    const previousYear = String(Number(year) - 1);
    const currentWorkerSnap = await scopedOrSocratesLegacy(`years/${year}/workers/${workerId}`, `workers/${workerId}`);
    let workerData = currentWorkerSnap.exists() ? currentWorkerSnap.val() : null;
    if (!workerData && Number.isFinite(Number(previousYear))) {
      const prevSnap = await scopedOrSocratesLegacy(`years/${previousYear}/workers/${workerId}`, `workers/${workerId}`);
      workerData = prevSnap.exists() ? prevSnap.val() : workerData;
    }
    const profile = workerData?.profile || workerData || {};
    const configSnap = await scopedOrSocratesLegacy(`years/${year}/teachers_config/${workerId}`, `teachers_config/${workerId}`);
    let teacherConfig = configSnap.exists() ? configSnap.val() : {};
    if (!teacherConfig?.teacherType && Number.isFinite(Number(previousYear))) {
      const prevCfgSnap = await scopedOrSocratesLegacy(`years/${previousYear}/teachers_config/${workerId}`, `teachers_config/${workerId}`);
      teacherConfig = teacherConfig?.teacherType ? teacherConfig : (prevCfgSnap.val() || teacherConfig || {});
    }
    const role = compactTitleCase(teacherConfig?.teacherType || profile?.role || profile?.designation || localStorage.getItem('somap_role') || 'Teacher');
    const normalizedRole = normalizeRole(role);
    const name = getWorkerName(profile) || 'Teacher';
    return {
      profile,
      role,
      normalizedRole,
      canManage: MANAGEMENT_ROLES.has(normalizedRole),
      name
    };
  }

  async function loadSchoolBranding() {
    const school = window.SOMAP?.getSchool?.() || { id: 'socrates-school', name: 'SoMAp School' };
    state.school = school;
    state.schoolId = school.id || 'socrates-school';
    if (els.schoolNameDisplay) {
      els.schoolNameDisplay.textContent = school.name || school.id || 'School';
    }
    if (els.currentYearLabel) {
      els.currentYearLabel.textContent = `Academic Year ${state.year}`;
    }
    let logoUrl = FALLBACK_LOGO;
    try {
      const snap = await state.db.ref(window.SOMAP.P('profile/logoUrl')).once('value');
      if (snap.exists() && snap.val()) logoUrl = snap.val();
    } catch (error) {
      console.warn('Unable to load school logo', error);
    }
    state.schoolLogoUrl = logoUrl || FALLBACK_LOGO;
    if (els.schoolLogoDisplay) {
      els.schoolLogoDisplay.src = state.schoolLogoUrl;
      els.schoolLogoDisplay.onerror = () => {
        els.schoolLogoDisplay.onerror = null;
        els.schoolLogoDisplay.src = FALLBACK_LOGO;
      };
    }
  }

  async function loadTeacherSources() {
    const year = state.year;
    const [workersSnap, configsSnap, catalogSnap] = await Promise.all([
      scopedOrSocratesLegacy(`years/${year}/workers`, 'workers'),
      scopedOrSocratesLegacy(`years/${year}/teachers_config`, 'teachers_config'),
      scopedOrSocratesLegacy(`subjectCatalog/${year}`, `subjectCatalog/${year}`)
    ]);
    const workersRaw = workersSnap.val() || {};
    const configsRaw = configsSnap.val() || {};
    const catalogRaw = catalogSnap.val() || {};
    const subjectCatalog = normalizeSubjectCatalog(catalogRaw);
    const teachers = [];

    Object.entries(workersRaw).forEach(([workerId, workerValue]) => {
      const worker = workerValue || {};
      const profile = worker.profile || worker || {};
      if (profile.active === false) return;
      const config = normalizeTeacherConfig(configsRaw[workerId] || {});
      if (!config.setupCompleted || !config.classSubjectMappings.length || !config.classes.length || !config.subjects.length) return;
      const validMappings = config.classSubjectMappings.filter((mapping) => mapping.class && mapping.subjects.length);
      const name = getWorkerName(profile);
      if (!validMappings.length || !name) return;
      teachers.push({
        workerId,
        name,
        teacherType: compactTitleCase(config.teacherType || profile.role || profile.designation || 'Teacher'),
        profile,
        classes: config.classes,
        subjects: config.subjects,
        classSubjectMappings: validMappings,
        status: 'Ready'
      });
    });

    teachers.sort((left, right) => {
      const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return String(left.workerId).localeCompare(String(right.workerId), 'en', { sensitivity: 'base' });
    });

    return { teachers, subjectCatalog };
  }

  async function loadSchemeHoursMap() {
    const map = {};
    try {
      const snap = await state.db.ref(`schemes/${state.schoolId}/templates/${state.year}`).once('value');
      const raw = snap.val() || {};
      Object.values(raw).forEach((bySubject) => {
        Object.values(bySubject || {}).forEach((byTerm) => {
          Object.values(byTerm || {}).forEach((templates) => {
            Object.values(templates || {}).forEach((template) => {
              const className = normalizeClassName(template?.className || template?.classKey || '');
              const subjectName = normalizeSubjectName(template?.subjectName || template?.subjectKey || '');
              const hours = Number(template?.hoursPerWeek || 0);
              const createdAt = Number(template?.meta?.createdAt || 0);
              if (!className || !subjectName || hours <= 0) return;
              map[className] = map[className] || {};
              const existing = map[className][subjectName];
              if (!existing || createdAt >= existing.createdAt) {
                map[className][subjectName] = { hours, createdAt };
              }
            });
          });
        });
      });
    } catch (error) {
      console.warn('Unable to load scheme hours', error);
    }
    return map;
  }

  async function loadTimetableRecords() {
    const year = state.year;
    const settingsEntries = {};
    const generatedEntries = {};
    await Promise.all(GROUP_ORDER.map(async (groupId) => {
      const [settingsSnap, generatedSnap] = await Promise.all([
        state.db.ref(window.SOMAP.P(`years/${year}/timetable/settings/${groupId}`)).once('value'),
        state.db.ref(window.SOMAP.P(`years/${year}/timetable/generated/${groupId}`)).once('value')
      ]);
      settingsEntries[groupId] = settingsSnap.exists() ? settingsSnap.val() : null;
      generatedEntries[groupId] = generatedSnap.exists() ? generatedSnap.val() : null;
    }));
    state.settingsByGroup = settingsEntries;
    state.generatedByGroup = generatedEntries;
  }

  function ensureSettingsShape() {
    GROUP_ORDER.forEach((groupId) => {
      state.settingsByGroup[groupId] = normalizeSettings(state.settingsByGroup[groupId], groupId, state.teachers, state.subjectCatalog);
      const generated = state.generatedByGroup[groupId];
      if (generated) {
        state.generatedByGroup[groupId] = normalizeGeneratedPayload(generated, groupId);
      }
    });
  }

  function subscribeToSourceChanges() {
    ['workers', 'teachers_config'].forEach((pathSegment) => {
      const ref = state.db.ref(window.SOMAP.P(`years/${state.year}/${pathSegment}`));
      const handler = () => scheduleRefresh();
      ref.on('value', handler);
      state.watchers.push(() => ref.off('value', handler));
    });
    const catalogRef = state.db.ref(window.SOMAP.P(`subjectCatalog/${state.year}`));
    const catalogHandler = () => scheduleRefresh();
    catalogRef.on('value', catalogHandler);
    state.watchers.push(() => catalogRef.off('value', catalogHandler));
    const schemeRef = state.db.ref(`schemes/${state.schoolId}/templates/${state.year}`);
    const schemeHandler = () => scheduleRefresh();
    schemeRef.on('value', schemeHandler);
    state.watchers.push(() => schemeRef.off('value', schemeHandler));
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      reloadAll({ reason: 'source-update', withAutoGenerate: true }).catch((error) => {
        console.warn('Background timetable refresh failed', error);
      });
    }, 700);
  }

  function detachWatchers() {
    clearTimeout(state.refreshTimer);
    state.watchers.forEach((off) => {
      try { off(); } catch (error) { console.warn('Failed to detach watcher', error); }
    });
    state.watchers = [];
  }

  function populateGroupSelector() {
    if (!els.groupSelect) return;
    els.groupSelect.innerHTML = GROUP_ORDER.map((groupId) => `<option value="${escapeAttr(groupId)}">${escapeHtml(GROUPS[groupId].title)}</option>`).join('');
    els.groupSelect.value = state.activeGroupId;
  }

  function setActiveTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tt-tab').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.tab === tabId);
    });
    document.querySelectorAll('.tt-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.id === `tab-${tabId}`);
    });
  }

  function renderAll() {
    const settings = getActiveSettings();
    const groupId = state.activeGroupId;
    const displayTimetable = getDisplayTimetable(groupId);
    const groupTeachers = getTeachersForGroup(groupId);
    if (els.groupSelect && els.groupSelect.value !== groupId) els.groupSelect.value = groupId;
    if (els.yearSelect && els.yearSelect.value !== state.year) els.yearSelect.value = state.year;
    renderAccessState();
    renderAlerts();
    renderSummary(settings, displayTimetable, groupTeachers);
    renderOverview(settings, displayTimetable, groupTeachers);
    renderTeacherFilter();
    renderTeacherTable();
    renderSettings();
    renderPreview();
    renderPdfPanel();
    renderHeaderStatus(displayTimetable);
  }

  function renderAccessState() {
    if (els.accessBadge) {
      els.accessBadge.textContent = state.viewer.canManage ? `Management access: ${state.viewer.role}` : `View only: ${state.viewer.role}`;
      els.accessBadge.className = `tt-pill ${state.viewer.canManage ? 'tt-pill--success' : 'tt-pill--neutral'}`;
    }
    const disabled = !state.viewer.canManage;
    [
      els.regenerateButton,
      els.generateAllButton,
      els.previewGenerateButton,
      els.saveSettingsButton,
      els.addSlotButton,
      els.resetSlotsButton,
      els.saveDraftInvalidButton
    ].forEach((button) => {
      if (button) button.disabled = disabled;
    });
    if (els.settingsStatusChip) {
      els.settingsStatusChip.textContent = disabled ? 'Read only settings' : (state.dirtySettings.has(state.activeGroupId) ? 'Unsaved changes' : 'Editable settings');
    }
  }

  function renderAlerts() {
    if (!els.alertStack) return;
    const groupId = state.activeGroupId;
    const settings = getActiveSettings();
    const generated = state.generatedByGroup[groupId];
    const alerts = [];
    if (generated && generated.sourceConfigHash && generated.sourceConfigHash !== state.sourceConfigHash) {
      alerts.push({
        type: 'warning',
        title: 'Teacher setup changed',
        body: 'Saved timetable data is older than the current teacher class and subject setup. The module is regenerating a fresh preview.'
      });
    }
    if (settings.seededDefaults) {
      alerts.push({
        type: 'warning',
        title: 'Seeded default period requirements are active',
        body: 'Review the weekly period counts before relying on the timetable as the final academic schedule.'
      });
    }
    buildStaffingWarnings(groupId, settings).forEach((warning) => alerts.push({ type: 'danger', title: warning.title, body: warning.body }));
    if (!alerts.length) {
      alerts.push({
        type: 'success',
        title: 'Timetable module is ready',
        body: state.viewer.canManage
          ? 'Adjust settings, regenerate, and export polished PDF copies from this page.'
          : 'You can view the active schedule, switch groups, and export the current timetable.'
      });
    }
    els.alertStack.innerHTML = alerts.map(renderAlert).join('');
  }

  function renderSummary(settings, displayTimetable, groupTeachers) {
    const subjects = getSubjectsForGroup(state.activeGroupId, settings);
    const totalPeriods = sumPeriodRequirements(settings.periodRequirements || {});
    const summary = displayTimetable?.validationSummary || blankValidationSummary();
    setText(els.summaryTeachers, String(groupTeachers.length));
    setText(els.summaryTeachersFoot, `${groupTeachers.length} configured teachers with completed setup`);
    setText(els.summaryClasses, String(GROUPS[state.activeGroupId].classes.length));
    setText(els.summaryClassesFoot, GROUPS[state.activeGroupId].title);
    setText(els.summarySubjects, String(subjects.length));
    setText(els.summarySubjectsFoot, `${subjects.length} subjects across current group requirements`);
    setText(els.summaryPeriods, String(totalPeriods));
    setText(els.summaryPeriodsFoot, `${totalPeriods} required teaching periods this week`);
    setText(els.summaryCollisions, String(summary.collisions || 0));
    setText(els.summaryCollisionsFoot, summary.collisions ? 'Conflicts must be resolved before a valid save.' : 'Zero teacher collisions detected.');
    const validationLabel = summary.isValid ? 'Valid' : (summary.unscheduled || summary.missingTeachers || summary.invalidPlacements || summary.lockedViolations ? 'Attention' : 'Draft');
    setText(els.summaryValidation, validationLabel);
    setText(els.summaryValidationFoot, `Unscheduled ${summary.unscheduled || 0} | Missing teachers ${summary.missingTeachers || 0} | Invalid ${summary.invalidPlacements || 0}`);
  }

  function renderOverview(settings, displayTimetable, groupTeachers) {
    const totalTeacherLoad = groupTeachers.reduce((sum, teacher) => sum + computeTeacherPotentialLoad(teacher, settings), 0);
    const overviewItems = [
      { title: 'Teacher workload', body: `${groupTeachers.length} active teachers are contributing a combined ${totalTeacherLoad} weekly periods in this group.` },
      { title: 'Teaching slots', body: `${countTeachingSlots(settings.slots)} teaching slots per day are available after fixed blocks are applied.` },
      { title: 'Manual locks', body: `${(settings.lockedCells || []).length} locked placements are preserved during regeneration.` },
      { title: 'Source freshness', body: describeGeneratedFreshness(displayTimetable) }
    ];
    if (els.overviewHighlights) {
      els.overviewHighlights.innerHTML = overviewItems
        .map((item) => `<div class="tt-inline-item"><strong>${escapeHtml(item.title)}</strong><div>${escapeHtml(item.body)}</div></div>`)
        .join('');
    }
    if (els.overviewStatusChip) {
      const summary = displayTimetable?.validationSummary || blankValidationSummary();
      els.overviewStatusChip.textContent = summary.isValid ? 'Valid timetable' : 'Review validation report';
      els.overviewStatusChip.className = `tt-inline-status ${summary.isValid ? 'tt-pill--success' : 'tt-pill--warning'}`;
    }
    renderValidationReport(displayTimetable?.validation || buildEmptyValidation());
  }

  function renderValidationReport(validation) {
    if (!els.validationSummaryPanel || !els.validationDetails) return;
    const summaryCards = [
      ['Collisions', validation.summary.collisions],
      ['Unscheduled', validation.summary.unscheduled],
      ['Missing Teachers', validation.summary.missingTeachers],
      ['Invalid Placements', validation.summary.invalidPlacements + validation.summary.lockedViolations]
    ];
    els.validationSummaryPanel.innerHTML = summaryCards
      .map(([label, value]) => `<div class="tt-validation-card"><div>${escapeHtml(label)}</div><strong>${escapeHtml(String(value))}</strong></div>`)
      .join('');
    const issues = flattenValidationIssues(validation);
    els.validationDetails.innerHTML = issues.length
      ? issues.map((item) => {
          const cls = item.level === 'danger' ? 'tt-report-item--danger' : 'tt-report-item--warning';
          return `<div class="tt-report-item ${cls}"><strong>${escapeHtml(item.title)}</strong><div>${escapeHtml(item.body)}</div></div>`;
        }).join('')
      : '<div class="tt-report-item tt-report-item--success">No conflicts detected in the current preview.</div>';
  }

  function renderTeacherFilter() {
    if (!els.teacherClassFilter) return;
    const options = ['All Classes', ...GROUPS[state.activeGroupId].classes];
    const current = els.teacherClassFilter.value || 'All Classes';
    els.teacherClassFilter.innerHTML = options.map((label) => `<option value="${escapeAttr(label)}">${escapeHtml(label)}</option>`).join('');
    els.teacherClassFilter.value = options.includes(current) ? current : 'All Classes';
  }

  function renderTeacherTable() {
    if (!els.teacherTableBody) return;
    const settings = getActiveSettings();
    const displayTimetable = getDisplayTimetable(state.activeGroupId);
    const legend = getTeacherLegend(state.activeGroupId, settings);
    const legendById = indexBy(legend, 'workerId');
    const classFilter = els.teacherClassFilter?.value || 'All Classes';
    const rows = getTeachersForGroup(state.activeGroupId)
      .filter((teacher) => classFilter === 'All Classes' || teacher.classes.includes(classFilter))
      .map((teacher) => {
        const scheduledLoad = computeTeacherScheduledLoad(teacher.workerId, displayTimetable);
        const potentialLoad = computeTeacherPotentialLoad(teacher, settings);
        return {
          number: legendById[teacher.workerId]?.number || '-',
          name: teacher.name,
          teacherType: teacher.teacherType,
          classes: teacher.classes.filter((className) => GROUPS[state.activeGroupId].classes.includes(className)),
          subjects: getTeacherSubjectsInGroup(teacher, state.activeGroupId),
          load: scheduledLoad > 0 ? `${scheduledLoad} scheduled / ${potentialLoad} target` : `${potentialLoad} target`,
          status: scheduledLoad > 0 ? 'Scheduled' : (potentialLoad > 0 ? 'Ready' : 'No active load')
        };
      });
    els.teacherTableBody.innerHTML = rows.length
      ? rows.map((row) => `
          <tr>
            <td><span class="tt-number-chip">${escapeHtml(String(row.number))}</span></td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.teacherType)}</td>
            <td>${escapeHtml(row.classes.join(', ') || '-')}</td>
            <td>${escapeHtml(row.subjects.join(', ') || '-')}</td>
            <td>${escapeHtml(row.load)}</td>
            <td>${escapeHtml(row.status)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="7" class="tt-table__empty">No configured teachers match this filter.</td></tr>';
  }

  function renderSettings() {
    renderSlotEditor();
    renderRequirementsEditor();
    renderSubjectOptionsEditor();
    renderLockedCellsEditor();
  }

  function renderSlotEditor() {
    const settings = getActiveSettings();
    if (!els.slotEditor) return;
    els.slotEditor.innerHTML = `
      <table class="tt-slot-table">
        <thead><tr><th>Start</th><th>End</th><th>Label</th><th>Type</th><th></th></tr></thead>
        <tbody>
          ${(settings.slots || []).map((slot, index) => `
            <tr>
              <td><input class="tt-input" data-slot-index="${index}" data-slot-field="start" value="${escapeAttr(slot.start || '')}" ${inputDisabled()}></td>
              <td><input class="tt-input" data-slot-index="${index}" data-slot-field="end" value="${escapeAttr(slot.end || '')}" ${inputDisabled()}></td>
              <td><input class="tt-input" data-slot-index="${index}" data-slot-field="label" value="${escapeAttr(slot.label || '')}" ${inputDisabled()}></td>
              <td>
                <select class="tt-select" data-slot-index="${index}" data-slot-field="isTeaching" ${inputDisabled()}>
                  <option value="true" ${slot.isTeaching ? 'selected' : ''}>Teaching</option>
                  <option value="false" ${slot.isTeaching ? '' : 'selected'}>Fixed Block</option>
                </select>
              </td>
              <td><button type="button" class="tt-btn tt-btn--ghost" data-remove-slot="${index}" ${state.viewer.canManage ? '' : 'disabled'}>Remove</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    els.slotEditor.querySelectorAll('[data-slot-index]').forEach((input) => {
      input.addEventListener('input', handleSlotInput);
      input.addEventListener('change', handleSlotInput);
    });
    els.slotEditor.querySelectorAll('[data-remove-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        mutateSettings((settingsDraft) => {
          settingsDraft.slots.splice(Number(button.dataset.removeSlot), 1);
        });
      });
    });
  }

  function renderRequirementsEditor() {
    const settings = getActiveSettings();
    if (!els.periodRequirementsEditor) return;
    els.periodRequirementsEditor.innerHTML = `
      <div class="tt-period-class-grid">
        ${GROUPS[state.activeGroupId].classes.map((className) => {
          const subjects = getSubjectsForClass(state.activeGroupId, className, settings);
          return `
            <article class="tt-period-card">
              <h4>${escapeHtml(className)}</h4>
              <table class="tt-period-table">
                <thead><tr><th>Subject</th><th>Weekly Periods</th><th>Staffed By</th></tr></thead>
                <tbody>
                  ${subjects.map((subject) => `
                    <tr>
                      <td>${escapeHtml(subject)}</td>
                      <td><input class="tt-number" type="number" min="0" max="20" step="1" data-period-class="${escapeAttr(className)}" data-period-subject="${escapeAttr(subject)}" value="${escapeAttr(String(settings.periodRequirements?.[className]?.[subject] ?? 0))}" ${inputDisabled()}></td>
                      <td>${escapeHtml(getCandidateTeachers(state.activeGroupId, className, subject).length ? `${getCandidateTeachers(state.activeGroupId, className, subject).length} teacher(s)` : 'No teacher')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </article>
          `;
        }).join('')}
      </div>
    `;
    els.periodRequirementsEditor.querySelectorAll('[data-period-class]').forEach((input) => {
      input.addEventListener('input', handlePeriodInput);
      input.addEventListener('change', handlePeriodInput);
    });
  }

  function renderSubjectOptionsEditor() {
    const settings = getActiveSettings();
    if (!els.subjectOptionsEditor) return;
    const subjects = getSubjectsForGroup(state.activeGroupId, settings);
    els.subjectOptionsEditor.innerHTML = `
      <table class="tt-subject-options-table">
        <thead><tr><th>Subject</th><th>Abbreviation</th><th>Color</th></tr></thead>
        <tbody>
          ${subjects.map((subject) => `
            <tr>
              <td>${escapeHtml(subject)}</td>
              <td><input class="tt-input" data-subject-abbreviation="${escapeAttr(subject)}" value="${escapeAttr(settings.subjectAbbreviations?.[subject] || makeSubjectAbbreviation(subject))}" ${inputDisabled()}></td>
              <td><input class="tt-color" type="color" data-subject-color="${escapeAttr(subject)}" value="${escapeAttr(toColorHex(settings.subjectColors?.[subject] || DEFAULT_SUBJECT_COLORS[subject] || '#dbeafe'))}" ${inputDisabled()}></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    els.subjectOptionsEditor.querySelectorAll('[data-subject-abbreviation]').forEach((input) => input.addEventListener('input', handleSubjectMetaInput));
    els.subjectOptionsEditor.querySelectorAll('[data-subject-color]').forEach((input) => input.addEventListener('input', handleSubjectMetaInput));
  }

  function renderLockedCellsEditor() {
    const settings = getActiveSettings();
    if (!els.lockedCellsEditor) return;
    const teachers = getTeachersForGroup(state.activeGroupId);
    const subjects = getSubjectsForGroup(state.activeGroupId, settings);
    const slotOptions = (settings.slots || []).map((slot) => `<option value="${escapeAttr(slot.id)}">${escapeHtml(`${slot.start}-${slot.end} | ${slot.label}`)}</option>`).join('');
    els.lockedCellsEditor.innerHTML = `
      <div class="tt-locked-form">
        <div class="tt-field"><label>Class</label><select id="lockClassSelect" class="tt-select" ${inputDisabled()}>${GROUPS[state.activeGroupId].classes.map((className) => `<option value="${escapeAttr(className)}">${escapeHtml(className)}</option>`).join('')}</select></div>
        <div class="tt-field"><label>Day</label><select id="lockDaySelect" class="tt-select" ${inputDisabled()}>${DAYS.map((day) => `<option value="${escapeAttr(day)}">${escapeHtml(day)}</option>`).join('')}</select></div>
        <div class="tt-field"><label>Slot</label><select id="lockSlotSelect" class="tt-select" ${inputDisabled()}>${slotOptions}</select></div>
        <div class="tt-field"><label>Placement Type</label><select id="lockTypeSelect" class="tt-select" ${inputDisabled()}><option value="teaching">Teaching</option><option value="fixed">Fixed Block</option></select></div>
        <div class="tt-field"><label>Subject</label><select id="lockSubjectSelect" class="tt-select" ${inputDisabled()}>${subjects.map((subject) => `<option value="${escapeAttr(subject)}">${escapeHtml(subject)}</option>`).join('')}</select></div>
        <div class="tt-field"><label>Teacher</label><select id="lockTeacherSelect" class="tt-select" ${inputDisabled()}><option value="">Choose teacher</option>${teachers.map((teacher) => `<option value="${escapeAttr(teacher.workerId)}">${escapeHtml(teacher.name)}</option>`).join('')}</select></div>
        <div class="tt-field tt-form-span-2"><label>Fixed Block Label</label><input id="lockLabelInput" class="tt-input" value="Assembly / Activity" ${inputDisabled()}></div>
        <div class="tt-field"><label>&nbsp;</label><button type="button" class="tt-btn tt-btn--secondary" id="addLockedCellButton" ${state.viewer.canManage ? '' : 'disabled'}>Add Locked Placement</button></div>
      </div>
      <table class="tt-locked-table">
        <thead><tr><th>Class</th><th>Day</th><th>Slot</th><th>Type</th><th>Subject / Label</th><th>Teacher</th><th></th></tr></thead>
        <tbody>
          ${(settings.lockedCells || []).length ? (settings.lockedCells || []).map((cell) => `
            <tr>
              <td>${escapeHtml(cell.className)}</td>
              <td>${escapeHtml(cell.day)}</td>
              <td>${escapeHtml(getSlotLabel(cell.slotId, settings.slots))}</td>
              <td>${escapeHtml(cell.type)}</td>
              <td>${escapeHtml(cell.type === 'fixed' ? (cell.label || 'Fixed Block') : (cell.subject || ''))}</td>
              <td>${escapeHtml(state.teacherMap[cell.teacherId]?.name || '-')}</td>
              <td><button type="button" class="tt-btn tt-btn--ghost" data-remove-lock="${escapeAttr(cell.id)}" ${state.viewer.canManage ? '' : 'disabled'}>Remove</button></td>
            </tr>
          `).join('') : '<tr><td colspan="7">No locked placements configured.</td></tr>'}
        </tbody>
      </table>
    `;
    document.getElementById('addLockedCellButton')?.addEventListener('click', addLockedPlacement);
    els.lockedCellsEditor.querySelectorAll('[data-remove-lock]').forEach((button) => {
      button.addEventListener('click', () => {
        mutateSettings((settingsDraft) => {
          settingsDraft.lockedCells = (settingsDraft.lockedCells || []).filter((item) => item.id !== button.dataset.removeLock);
        });
      });
    });
  }

  function renderPreview() {
    if (!els.previewShell || !els.previewStatusChip) return;
    const preview = getDisplayTimetable(state.activeGroupId);
    if (!preview) {
      els.previewStatusChip.textContent = 'Waiting for generation';
      els.previewShell.innerHTML = '<div class="tt-preview-empty">No timetable generated yet.</div>';
      return;
    }
    const summary = preview.validationSummary || blankValidationSummary();
    els.previewStatusChip.textContent = summary.isValid ? 'Valid preview ready' : 'Preview contains issues';
    els.previewStatusChip.className = `tt-inline-status ${summary.isValid ? 'tt-pill--success' : 'tt-pill--warning'}`;
    els.previewShell.innerHTML = `
      <article class="tt-preview-document" id="printDocument">
        <div class="tt-preview-document__header">
          <div class="tt-preview-document__brand">
            <img src="${escapeAttr(state.schoolLogoUrl || FALLBACK_LOGO)}" alt="School logo">
            <div>
              <div class="tt-card__eyebrow">${escapeHtml(state.school?.name || state.schoolId || 'School')}</div>
              <h2>GENERAL SCHOOL TIMETABLE</h2>
              <div>${escapeHtml(GROUPS[state.activeGroupId].title)}</div>
            </div>
          </div>
          <div class="tt-preview-document__meta">
            <div><strong>Academic Year:</strong> ${escapeHtml(state.year)}</div>
            <div><strong>Generated:</strong> ${escapeHtml(formatDateTime(preview.generatedAt))}</div>
            <div><strong>Downloaded / Printed:</strong> ${escapeHtml(state.lastDownloadedAt || 'Not yet')}</div>
            <div><strong>Status:</strong> ${escapeHtml(summary.isValid ? 'Valid - conflict free' : 'Review validation report')}</div>
          </div>
        </div>
        ${renderCombinedPreviewTable(preview)}
        <div class="tt-card__eyebrow" style="margin-top:18px;">Teacher Legend</div>
        <div class="tt-legend-grid">
          ${(preview.teacherLegend || []).map((teacher) => `
            <div class="tt-legend-card">
              <strong>${escapeHtml(`${teacher.number}. ${teacher.name}`)}</strong>
              <small>${escapeHtml(`${teacher.teacherType} | ${teacher.classes.join(', ') || 'No classes'} | ${teacher.subjects.join(', ') || 'No subjects'}`)}</small>
            </div>
          `).join('')}
        </div>
        <div class="tt-card__eyebrow" style="margin-top:18px;">Subject Legend</div>
        <div class="tt-subject-legend">
          ${(preview.subjectLegend || []).map((subject) => `
            <span class="tt-subject-pill">
              <span class="tt-subject-pill__dot" style="background:${escapeAttr(subject.color)}"></span>
              ${escapeHtml(`${subject.abbreviation} = ${subject.subject}`)}
            </span>
          `).join('')}
        </div>
      </article>
    `;
  }

  function renderCombinedPreviewTable(preview) {
    const slots = preview.slots || [];
    const rows = [];
    DAYS.forEach((day) => {
      preview.classes.forEach((className, classIndex) => {
        const cells = slots.map((slot) => `<td>${renderGridCell(preview.grid?.[className]?.[day]?.[slot.id] || createEmptyCell(slot, day))}</td>`).join('');
        rows.push(`
          <tr>
            ${classIndex === 0 ? `<td class="tt-class-cell" rowspan="${preview.classes.length}">${escapeHtml(day)}</td>` : ''}
            <td class="tt-class-cell">${escapeHtml(className)}</td>
            ${cells}
          </tr>
        `);
      });
    });
    return `
      <section class="tt-day-card">
        <div class="tt-day-table-wrap">
          <table class="tt-day-table">
            <thead>
              <tr>
                <th class="tt-class-cell">Day</th>
                <th class="tt-class-cell">Class</th>
                ${slots.map((slot) => `<th class="tt-slot-head"><strong>${escapeHtml(slot.start)} - ${escapeHtml(slot.end)}</strong><span>${escapeHtml(slot.label)}</span></th>`).join('')}
              </tr>
            </thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderDayTable(preview, day) {
    const slots = preview.slots || [];
    const rows = preview.classes.map((className) => {
      const rowCells = slots.map((slot) => `<td>${renderGridCell(preview.grid?.[className]?.[day]?.[slot.id] || createEmptyCell(slot, day))}</td>`).join('');
      return `<tr><td class="tt-class-cell">${escapeHtml(className)}</td>${rowCells}</tr>`;
    }).join('');
    return `
      <section class="tt-day-card">
        <h3>${escapeHtml(day)}</h3>
        <div class="tt-day-table-wrap">
          <table class="tt-day-table">
            <thead>
              <tr>
                <th class="tt-class-cell">Class</th>
                ${slots.map((slot) => `<th class="tt-slot-head"><strong>${escapeHtml(slot.start)} - ${escapeHtml(slot.end)}</strong><span>${escapeHtml(slot.label)}</span></th>`).join('')}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderGridCell(cell) {
    if (cell.type === 'fixed') {
      return `<div class="tt-cell tt-cell--fixed"><div class="tt-cell__code">${escapeHtml(cell.label || 'Fixed')}</div><div class="tt-cell__text">${escapeHtml(cell.note || '')}</div></div>`;
    }
    if (cell.type === 'teaching') {
      return `<div class="tt-cell tt-cell--teaching" style="background:${escapeAttr(toColorHex(cell.color || '#dbeafe'))};"><div class="tt-cell__code">${escapeHtml(cell.code || `${cell.abbreviation}-${cell.teacherNumber}`)}</div><div class="tt-cell__text">${escapeHtml(cell.subject || '')}</div></div>`;
    }
    return '<div class="tt-cell tt-cell--empty"><div class="tt-cell__code">OPEN</div><div class="tt-cell__text">No required period</div></div>';
  }

  function renderPdfPanel() {
    if (!els.pdfMetaPanel || !els.printNotesPanel) return;
    const display = getDisplayTimetable(state.activeGroupId);
    const summary = display?.validationSummary || blankValidationSummary();
    els.pdfMetaPanel.innerHTML = `
      <div class="tt-inline-item"><strong>Current group</strong><div>${escapeHtml(GROUPS[state.activeGroupId].title)}</div></div>
      <div class="tt-inline-item"><strong>Generated status</strong><div>${escapeHtml(describeGeneratedFreshness(display))}</div></div>
      <div class="tt-inline-item"><strong>Validation</strong><div>${escapeHtml(summary.isValid ? 'Ready for official export' : 'PDF will include issue report')}</div></div>
    `;
    els.printNotesPanel.innerHTML = [
      'PDF exports use A4 landscape layout with school branding, group title, year, generation timestamp, teacher legend, and subject legend.',
      'Print uses the same preview document. Open the Generate / Preview tab to inspect colors and table density before printing.',
      state.viewer.canManage ? 'Management roles can save fresh timetables after successful generation.' : 'You are viewing this module in read-only mode. Downloads remain available.'
    ].map((note) => `<div class="tt-report-item">${escapeHtml(note)}</div>`).join('');
  }

  function renderHeaderStatus(displayTimetable) {
    const saved = state.generatedByGroup[state.activeGroupId];
    const current = displayTimetable;
    const summary = current?.validationSummary || blankValidationSummary();
    if (els.generatedStatusBadge) {
      const stale = Boolean(saved?.sourceConfigHash && saved.sourceConfigHash !== state.sourceConfigHash);
      let label = 'No generated timetable';
      let className = 'tt-pill tt-pill--warning';
      if (current?.isSaved && current?.isValid && !stale) {
        label = 'Saved valid timetable';
        className = 'tt-pill tt-pill--success';
      } else if (stale) {
        label = 'Needs regeneration';
      } else if (current) {
        label = current.isSaved ? 'Saved timetable loaded' : 'Live preview loaded';
        className = summary.isValid ? 'tt-pill tt-pill--success' : 'tt-pill tt-pill--warning';
      }
      els.generatedStatusBadge.textContent = label;
      els.generatedStatusBadge.className = className;
    }
    if (els.collisionStatusBadge) {
      els.collisionStatusBadge.textContent = summary.collisions ? `${summary.collisions} collision(s)` : 'No collisions';
      els.collisionStatusBadge.className = `tt-pill ${summary.collisions ? 'tt-pill--danger' : 'tt-pill--success'}`;
    }
    setText(els.lastGeneratedValue, current?.generatedAt ? formatDateTime(current.generatedAt) : 'Not generated yet');
    setText(els.lastDownloadedValue, state.lastDownloadedAt || 'No export yet');
  }

  async function maybeAutoRegenerateAll(reason) {
    if (state.autoGenerating) return;
    const staleGroups = GROUP_ORDER.filter((groupId) => {
      const generated = state.generatedByGroup[groupId];
      return !generated || generated.sourceConfigHash !== state.sourceConfigHash;
    });
    if (!staleGroups.length) return;
    if (state.viewer.canManage) {
      state.autoGenerating = true;
      try {
        for (const groupId of staleGroups) {
          await generateGroup(groupId, { saveMode: 'validOnly', silent: true, openPreview: false, autoReason: reason });
        }
        renderAll();
      } finally {
        state.autoGenerating = false;
      }
      toast(`Timetable source changed. Regenerated ${staleGroups.length} group(s).`, 'info');
      return;
    }
    await maybeAutoRegenerateCurrent(reason);
  }

  async function maybeAutoRegenerateCurrent(reason) {
    const generated = state.generatedByGroup[state.activeGroupId];
    if (!generated || generated.sourceConfigHash !== state.sourceConfigHash) {
      await generateGroup(state.activeGroupId, { saveMode: 'none', silent: true, openPreview: false, autoReason: reason });
      renderAll();
    }
  }

  async function generateAllGroups({ saveMode = 'validOnly', silent = false } = {}) {
    if (!state.viewer.canManage) {
      toast('Generation is limited to management roles.', 'warning');
      return;
    }
    let validCount = 0;
    for (const groupId of GROUP_ORDER) {
      const result = await generateGroup(groupId, { saveMode, silent: true, openPreview: false, autoReason: 'generate-all' });
      if (result?.validationSummary?.isValid) validCount += 1;
    }
    renderAll();
    setActiveTab('preview');
    if (!silent) toast(`Generated ${GROUP_ORDER.length} groups. ${validCount} valid timetable(s) saved.`, 'success');
  }

  async function generateGroup(groupId, { saveMode = 'validOnly', silent = false, openPreview = true } = {}) {
    if (!GROUPS[groupId]) return null;
    if (!state.viewer.canManage && saveMode !== 'none') {
      toast('Generation is limited to management roles.', 'warning');
      return null;
    }
    const settings = normalizeSettings(state.settingsByGroup[groupId], groupId, state.teachers, state.subjectCatalog);
    state.settingsByGroup[groupId] = settings;
    const teachers = getTeachersForGroup(groupId);
    const engineResult = buildTimetable(groupId, settings, teachers);
    const payload = buildGeneratedPayload(groupId, settings, teachers, engineResult, false);
    state.previewByGroup[groupId] = payload;
    if (saveMode === 'validOnly' && payload.validationSummary.isValid) {
      await persistSettings(groupId, settings, true);
      await persistGenerated(groupId, payload);
      state.generatedByGroup[groupId] = { ...payload, isSaved: true };
      state.previewByGroup[groupId] = { ...payload, isSaved: true };
      state.dirtySettings.delete(groupId);
    } else if (saveMode === 'draftIfInvalid') {
      await persistSettings(groupId, settings, true);
      await persistGenerated(groupId, { ...payload, status: payload.validationSummary.isValid ? 'valid' : 'draft-invalid' });
      state.generatedByGroup[groupId] = { ...payload, isSaved: true };
      state.previewByGroup[groupId] = { ...payload, isSaved: true };
      state.dirtySettings.delete(groupId);
    }
    if (openPreview) {
      state.activeGroupId = groupId;
      if (els.groupSelect) els.groupSelect.value = groupId;
      setActiveTab('preview');
    }
    renderAll();
    if (!silent) {
      toast(
        payload.validationSummary.isValid
          ? `${GROUPS[groupId].title} generated successfully without collisions.`
          : `${GROUPS[groupId].title} generated with issues. Review the conflict report.`,
        payload.validationSummary.isValid ? 'success' : 'warning'
      );
    }
    return payload;
  }

  async function saveCurrentSettings() {
    if (!state.viewer.canManage) {
      toast('Settings are read-only for your role.', 'warning');
      return;
    }
    const settings = normalizeSettings(getActiveSettings(), state.activeGroupId, state.teachers, state.subjectCatalog);
    settings.seededDefaults = false;
    state.settingsByGroup[state.activeGroupId] = settings;
    await persistSettings(state.activeGroupId, settings, false);
    state.dirtySettings.delete(state.activeGroupId);
    renderAll();
    toast('Timetable settings saved.', 'success');
  }

  async function saveDraftInvalid(groupId) {
    if (!state.viewer.canManage) {
      toast('Saving draft timetables is limited to management roles.', 'warning');
      return;
    }
    const preview = state.previewByGroup[groupId];
    if (!preview) {
      toast('Generate a preview first.', 'warning');
      return;
    }
    await persistSettings(groupId, getSettingsForGroup(groupId), true);
    await persistGenerated(groupId, { ...preview, status: preview.validationSummary.isValid ? 'valid' : 'draft-invalid' });
    state.generatedByGroup[groupId] = { ...preview, isSaved: true };
    renderAll();
    toast('Draft timetable saved with its validation report.', 'success');
  }

  async function persistSettings(groupId, settings, forceNormalize) {
    const normalized = forceNormalize ? normalizeSettings(settings, groupId, state.teachers, state.subjectCatalog) : settings;
    const payload = {
      ...normalized,
      groupId,
      classes: GROUPS[groupId].classes,
      fixedBlocks: (normalized.slots || []).filter((slot) => !slot.isTeaching).map((slot) => ({ slotId: slot.id, label: slot.label, start: slot.start, end: slot.end })),
      updatedAt: Date.now(),
      updatedBy: buildActor()
    };
    await state.db.ref(window.SOMAP.P(`years/${state.year}/timetable/settings/${groupId}`)).set(payload);
  }

  async function persistGenerated(groupId, payload) {
    await state.db.ref(window.SOMAP.P(`years/${state.year}/timetable/generated/${groupId}`)).set({
      ...payload,
      isSaved: undefined
    });
  }

  function addLockedPlacement() {
    if (!state.viewer.canManage) return;
    const className = document.getElementById('lockClassSelect')?.value || GROUPS[state.activeGroupId].classes[0];
    const day = document.getElementById('lockDaySelect')?.value || DAYS[0];
    const slotId = document.getElementById('lockSlotSelect')?.value || '';
    const type = document.getElementById('lockTypeSelect')?.value || 'teaching';
    const subject = document.getElementById('lockSubjectSelect')?.value || '';
    const teacherId = document.getElementById('lockTeacherSelect')?.value || '';
    const label = document.getElementById('lockLabelInput')?.value || 'Fixed Block';
    if (!slotId) {
      toast('Choose a slot before adding a locked placement.', 'warning');
      return;
    }
    if (type === 'teaching' && (!subject || !teacherId)) {
      toast('Choose both subject and teacher for a locked teaching placement.', 'warning');
      return;
    }
    mutateSettings((settings) => {
      settings.lockedCells = settings.lockedCells || [];
      settings.lockedCells.push({
        id: `lock_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        className,
        day,
        slotId,
        type,
        subject: type === 'teaching' ? normalizeSubjectName(subject) : '',
        teacherId: type === 'teaching' ? teacherId : '',
        label: type === 'fixed' ? label : ''
      });
    });
  }

  function handleSlotInput(event) {
    if (!state.viewer.canManage) return;
    const index = Number(event.target.dataset.slotIndex);
    const field = event.target.dataset.slotField;
    mutateSettings((settings) => {
      const slot = settings.slots[index];
      if (!slot) return;
      slot[field] = field === 'isTeaching' ? event.target.value === 'true' : event.target.value;
      if (field === 'label' && !slot.id) slot.id = slugify(slot.label || `slot_${index + 1}`);
    });
  }

  function handlePeriodInput(event) {
    if (!state.viewer.canManage) return;
    const className = event.target.dataset.periodClass;
    const subject = event.target.dataset.periodSubject;
    const value = Math.max(0, Number(event.target.value || 0));
    mutateSettings((settings) => {
      settings.periodRequirements[className] = settings.periodRequirements[className] || {};
      settings.periodRequirements[className][subject] = value;
    });
  }

  function handleSubjectMetaInput(event) {
    if (!state.viewer.canManage) return;
    if (event.target.dataset.subjectAbbreviation) {
      const subject = event.target.dataset.subjectAbbreviation;
      mutateSettings((settings) => {
        settings.subjectAbbreviations[subject] = sanitizeAbbreviation(event.target.value);
      });
      return;
    }
    if (event.target.dataset.subjectColor) {
      const subject = event.target.dataset.subjectColor;
      mutateSettings((settings) => {
        settings.subjectColors[subject] = toColorHex(event.target.value);
      });
    }
  }

  function mutateSettings(mutator) {
    const groupId = state.activeGroupId;
    const draft = deepClone(getSettingsForGroup(groupId));
    mutator(draft);
    draft.seededDefaults = false;
    state.settingsByGroup[groupId] = normalizeSettings(draft, groupId, state.teachers, state.subjectCatalog);
    state.dirtySettings.add(groupId);
    renderAll();
  }

  function buildTimetable(groupId, settings, teachers) {
    const group = GROUPS[groupId];
    const slots = normalizeSlots(settings.slots || []);
    const teacherLegend = buildTeacherLegend(groupId, settings, teachers);
    const subjectLegend = buildSubjectLegend(groupId, settings);
    const teacherNumberMap = Object.fromEntries(teacherLegend.map((teacher) => [teacher.workerId, teacher.number]));
    const candidateMap = buildCandidateTeacherMap(groupId, teachers);
    const initialGrid = createBaseGrid(group.classes, slots);
    const classOccupancy = {};
    const teacherOccupancy = {};
    const classSubjectDayCount = {};
    const teacherDayLoad = {};
    const teacherEdgeLoad = {};
    const demand = cloneRequirementMap(settings.periodRequirements || {});
    const fixedIssues = [];

    group.classes.forEach((className) => {
      classOccupancy[className] = {};
      classSubjectDayCount[className] = {};
      DAYS.forEach((day) => {
        classOccupancy[className][day] = {};
        classSubjectDayCount[className][day] = {};
      });
    });
    teacherLegend.forEach((teacher) => {
      teacherOccupancy[teacher.workerId] = {};
      teacherDayLoad[teacher.workerId] = {};
      teacherEdgeLoad[teacher.workerId] = { first: 0, last: 0 };
      DAYS.forEach((day) => {
        teacherOccupancy[teacher.workerId][day] = {};
        teacherDayLoad[teacher.workerId][day] = 0;
      });
    });

    applyLockedCells({
      settings,
      slots,
      grid: initialGrid,
      demand,
      candidateMap,
      teacherNumberMap,
      subjectLegend,
      classOccupancy,
      teacherOccupancy,
      classSubjectDayCount,
      teacherDayLoad,
      teacherEdgeLoad,
      fixedIssues
    });

    GROUPS[groupId].classes.forEach((className) => {
      const required = Object.values(demand[className] || {}).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
      const openTeachingSlots = DAYS.reduce((sum, day) => sum + slots.filter((slot) => slot.isTeaching && !initialGrid[className][day][slot.id]?.type).length, 0);
      if (required > openTeachingSlots) {
        fixedIssues.push({
          title: 'Weekly periods exceed available teaching slots',
          body: `${className} still needs ${required} periods, but only ${openTeachingSlots} teaching slots are open after fixed blocks and locked placements.`
        });
      }
    });

    const searchState = {
      groupId,
      settings,
      slots,
      teachers,
      groupClasses: group.classes,
      grid: initialGrid,
      demand,
      candidateMap,
      teacherNumberMap,
      subjectLegend,
      classOccupancy,
      teacherOccupancy,
      classSubjectDayCount,
      teacherDayLoad,
      teacherEdgeLoad,
      nodesVisited: 0,
      limit: 40000,
      bestGrid: null,
      bestDemandScore: Infinity,
      fixedIssues
    };

    const solved = searchSchedule(searchState);
    const finalGrid = solved ? searchState.grid : (searchState.bestGrid || searchState.grid);
    const validation = validateTimetable({
      settings,
      slots,
      classes: group.classes,
      grid: finalGrid,
      teacherLegend,
      candidateMap,
      lockedCells: settings.lockedCells || [],
      fixedIssues
    });

    return {
      solved,
      grid: finalGrid,
      slots,
      classes: group.classes,
      teacherLegend,
      subjectLegend,
      validation
    };
  }

  function applyLockedCells(context) {
    const { settings, slots, grid, demand, candidateMap, teacherNumberMap, subjectLegend, classOccupancy, teacherOccupancy, classSubjectDayCount, teacherDayLoad, teacherEdgeLoad, fixedIssues } = context;
    const slotIndexMap = Object.fromEntries(slots.map((slot, index) => [slot.id, index]));
    (settings.lockedCells || []).forEach((cell) => {
      if (!grid[cell.className] || !grid[cell.className][cell.day]) {
        fixedIssues.push({ title: 'Locked placement points to an unknown class/day', body: `${cell.className} / ${cell.day} / ${cell.slotId}` });
        return;
      }
      const slot = slots.find((entry) => entry.id === cell.slotId);
      if (!slot) {
        fixedIssues.push({ title: 'Locked placement points to an unknown slot', body: `${cell.className} / ${cell.day} / ${cell.slotId}` });
        return;
      }
      if (getAutoFixedCell(slot, cell.day) && cell.type !== 'fixed') {
        fixedIssues.push({ title: 'Locked teaching cell is inside a fixed timetable block', body: `${cell.className} / ${cell.day} / ${getSlotLabel(cell.slotId, slots)}` });
        return;
      }
      if (cell.type === 'fixed' || !slot.isTeaching) {
        grid[cell.className][cell.day][cell.slotId] = { type: 'fixed', label: cell.label || slot.label || 'Fixed Block', note: cell.type === 'fixed' ? 'Locked placement' : 'Fixed slot template', slotId: cell.slotId };
        classOccupancy[cell.className][cell.day][cell.slotId] = true;
        return;
      }
      const subject = normalizeSubjectName(cell.subject);
      const teacherId = String(cell.teacherId || '').trim();
      const candidateTeachers = candidateMap[cell.className]?.[subject] || [];
      if (!candidateTeachers.some((teacher) => teacher.workerId === teacherId)) {
        fixedIssues.push({ title: 'Locked teaching cell uses an invalid teacher assignment', body: `${cell.className} / ${cell.day} / ${getSlotLabel(cell.slotId, slots)} / ${subject || 'Unknown subject'}` });
      }
      if (isMorningPrioritySubject(subject) && !slotEndsByNoon(slot)) {
        fixedIssues.push({ title: 'Locked morning-core subject is placed after 12:00 PM', body: `${cell.className} / ${subject} is locked on ${cell.day} at ${getSlotLabel(cell.slotId, slots)}.` });
      }
      const subjectMeta = subjectLegend.find((item) => item.subject === subject) || {
        subject,
        abbreviation: makeSubjectAbbreviation(subject),
        color: DEFAULT_SUBJECT_COLORS[subject] || '#dbeafe'
      };
      const teacherLegendNumber = teacherNumberMap[teacherId] || '?';
      grid[cell.className][cell.day][cell.slotId] = {
        type: 'teaching',
        locked: true,
        subject,
        teacherId,
        teacherNumber: teacherLegendNumber,
        abbreviation: subjectMeta.abbreviation,
        color: subjectMeta.color,
        code: `${subjectMeta.abbreviation}-${teacherLegendNumber}`
      };
      classOccupancy[cell.className][cell.day][cell.slotId] = true;
      teacherOccupancy[teacherId] = teacherOccupancy[teacherId] || {};
      teacherOccupancy[teacherId][cell.day] = teacherOccupancy[teacherId][cell.day] || {};
      teacherOccupancy[teacherId][cell.day][cell.slotId] = cell.className;
      classSubjectDayCount[cell.className][cell.day][subject] = (classSubjectDayCount[cell.className][cell.day][subject] || 0) + 1;
      teacherDayLoad[teacherId] = teacherDayLoad[teacherId] || {};
      teacherDayLoad[teacherId][cell.day] = (teacherDayLoad[teacherId][cell.day] || 0) + 1;
      teacherEdgeLoad[teacherId] = teacherEdgeLoad[teacherId] || { first: 0, last: 0 };
      if ((slotIndexMap[cell.slotId] || 0) === 0) teacherEdgeLoad[teacherId].first += 1;
      if ((slotIndexMap[cell.slotId] || 0) === slots.length - 1) teacherEdgeLoad[teacherId].last += 1;
      if (demand[cell.className]?.[subject] > 0) {
        demand[cell.className][subject] -= 1;
      } else {
        fixedIssues.push({ title: 'Locked teaching cell exceeds configured weekly requirement', body: `${cell.className} / ${subject} is locked more times than required.` });
      }
    });
  }

  function searchSchedule(searchState) {
    const demandScore = computeDemandScore(searchState.demand);
    if (demandScore < searchState.bestDemandScore) {
      searchState.bestDemandScore = demandScore;
      searchState.bestGrid = deepClone(searchState.grid);
    }
    if (demandScore === 0) return true;
    if (searchState.nodesVisited > searchState.limit) return false;
    searchState.nodesVisited += 1;

    const nextChoice = chooseMostConstrainedDemand(searchState);
    if (!nextChoice || !nextChoice.placements.length) return false;
    for (const placement of nextChoice.placements) {
      const undo = placeLesson(searchState, nextChoice.className, nextChoice.subject, placement);
      if (searchSchedule(searchState)) return true;
      undo();
    }
    return false;
  }

  function chooseMostConstrainedDemand(searchState) {
    const entries = [];
    Object.entries(searchState.demand).forEach(([className, bucket]) => {
      Object.entries(bucket || {}).forEach(([subject, remaining]) => {
        if (remaining > 0) {
          entries.push({ className, subject, remaining, placements: collectPlacements(searchState, className, subject) });
        }
      });
    });
    if (!entries.length) return null;
    const schedulable = entries.filter((entry) => entry.placements.length > 0);
    if (!schedulable.length) return null;
    schedulable.sort((left, right) => {
      if (left.placements.length !== right.placements.length) return left.placements.length - right.placements.length;
      if (left.remaining !== right.remaining) return right.remaining - left.remaining;
      return `${left.className}:${left.subject}`.localeCompare(`${right.className}:${right.subject}`);
    });
    return schedulable[0];
  }

  function collectPlacements(searchState, className, subject) {
    const placements = [];
    const slotIndexMap = Object.fromEntries(searchState.slots.map((slot, index) => [slot.id, index]));
    const remainingForSubject = Number(searchState.demand?.[className]?.[subject] || 0);
    const unusedSchedulableDays = countUnusedSchedulableDays(searchState, className, subject);
    (searchState.candidateMap[className]?.[subject] || []).forEach((teacher) => {
      DAYS.forEach((day) => {
        searchState.slots.forEach((slot) => {
          if (!slot.isTeaching) return;
          if (isMorningPrioritySubject(subject) && !slotEndsByNoon(slot)) return;
          if (searchState.grid[className][day][slot.id]?.type) return;
          if (searchState.teacherOccupancy[teacher.workerId]?.[day]?.[slot.id]) return;
          const slotIndex = slotIndexMap[slot.id];
          const sameDayCount = searchState.classSubjectDayCount[className][day][subject] || 0;
          if (sameDayCount > 0 && remainingForSubject <= unusedSchedulableDays) return;
          const teacherLoad = searchState.teacherDayLoad[teacher.workerId]?.[day] || 0;
          const edgePenalty = slotIndex === 0
            ? (searchState.teacherEdgeLoad[teacher.workerId]?.first || 0)
            : (slotIndex === searchState.slots.length - 1 ? (searchState.teacherEdgeLoad[teacher.workerId]?.last || 0) : 0);
          const earlyBias = CORE_SUBJECTS.has(subject) ? slotIndex * 2 : slotIndex;
          const daySpreadPenalty = sameDayCount > 0 ? 28 : -10;
          const subjectMeta = searchState.subjectLegend.find((item) => item.subject === subject) || { abbreviation: makeSubjectAbbreviation(subject), color: '#dbeafe' };
          placements.push({
            className,
            subject,
            teacherId: teacher.workerId,
            teacherNumber: searchState.teacherNumberMap[teacher.workerId] || '?',
            day,
            slotId: slot.id,
            abbreviation: subjectMeta.abbreviation,
            color: subjectMeta.color,
            score: sameDayCount * 18 + teacherLoad * 4 + edgePenalty * 3 + earlyBias + daySpreadPenalty
          });
        });
      });
    });
    placements.sort((left, right) => left.score - right.score || `${left.day}:${left.slotId}:${left.teacherId}`.localeCompare(`${right.day}:${right.slotId}:${right.teacherId}`));
    return placements;
  }

  function placeLesson(searchState, className, subject, placement) {
    const slotIndex = searchState.slots.findIndex((slot) => slot.id === placement.slotId);
    searchState.grid[className][placement.day][placement.slotId] = {
      type: 'teaching',
      subject,
      teacherId: placement.teacherId,
      teacherNumber: placement.teacherNumber,
      abbreviation: placement.abbreviation,
      color: placement.color,
      code: `${placement.abbreviation}-${placement.teacherNumber}`
    };
    searchState.teacherOccupancy[placement.teacherId][placement.day][placement.slotId] = className;
    searchState.classSubjectDayCount[className][placement.day][subject] = (searchState.classSubjectDayCount[className][placement.day][subject] || 0) + 1;
    searchState.teacherDayLoad[placement.teacherId][placement.day] = (searchState.teacherDayLoad[placement.teacherId][placement.day] || 0) + 1;
    if (slotIndex === 0) searchState.teacherEdgeLoad[placement.teacherId].first += 1;
    if (slotIndex === searchState.slots.length - 1) searchState.teacherEdgeLoad[placement.teacherId].last += 1;
    searchState.demand[className][subject] -= 1;
    return () => {
      delete searchState.grid[className][placement.day][placement.slotId];
      delete searchState.teacherOccupancy[placement.teacherId][placement.day][placement.slotId];
      searchState.classSubjectDayCount[className][placement.day][subject] -= 1;
      searchState.teacherDayLoad[placement.teacherId][placement.day] -= 1;
      if (slotIndex === 0) searchState.teacherEdgeLoad[placement.teacherId].first -= 1;
      if (slotIndex === searchState.slots.length - 1) searchState.teacherEdgeLoad[placement.teacherId].last -= 1;
      searchState.demand[className][subject] += 1;
    };
  }

  function validateTimetable({ settings, slots, classes, grid, teacherLegend, candidateMap, lockedCells, fixedIssues }) {
    const collisions = [];
    const missingTeachers = [];
    const unscheduled = [];
    const invalidPlacements = [];
    const lockedViolations = [];
    const teacherSeen = {};
    const actualCounts = {};
    const lockedMap = {};
    (lockedCells || []).forEach((cell) => {
      lockedMap[`${cell.className}|${cell.day}|${cell.slotId}`] = cell;
    });

    classes.forEach((className) => {
      actualCounts[className] = {};
      DAYS.forEach((day) => {
        (slots || []).forEach((slot) => {
          const cell = grid?.[className]?.[day]?.[slot.id] || null;
          if (!cell) return;
          const key = `${day}|${slot.id}`;
          if (cell.type === 'teaching') {
            if (!slot.isTeaching) {
              lockedViolations.push({ title: 'Teaching cell placed in a fixed block', body: `${className} / ${day} / ${getSlotLabel(slot.id, slots)}` });
            }
            if (isFridayAfternoonClosure(day, slot)) {
              lockedViolations.push({ title: 'Friday afternoon block was used for teaching', body: `${className} / ${day} / ${getSlotLabel(slot.id, slots)}` });
            }
            if (isMorningPrioritySubject(cell.subject) && !slotEndsByNoon(slot)) {
              invalidPlacements.push({ title: 'Morning-core subject placed after 12:00 PM', body: `${className} / ${cell.subject} is scheduled on ${day} at ${getSlotLabel(slot.id, slots)}.` });
            }
            if (!cell.teacherId) {
              invalidPlacements.push({ title: 'Teaching cell is missing a teacher', body: `${className} / ${day} / ${getSlotLabel(slot.id, slots)} / ${cell.subject || 'Unknown subject'}` });
            }
            const teacherKey = `${key}|${cell.teacherId}`;
            if (teacherSeen[teacherKey]) {
              collisions.push({ title: 'Teacher collision detected', body: `${cell.teacherId} appears in ${teacherSeen[teacherKey]} and ${className} at ${day} ${getSlotLabel(slot.id, slots)}` });
            } else {
              teacherSeen[teacherKey] = className;
            }
            if (!(candidateMap[className]?.[normalizeSubjectName(cell.subject)] || []).some((teacher) => teacher.workerId === cell.teacherId)) {
              invalidPlacements.push({ title: 'Teacher is not assigned to this class + subject', body: `${className} / ${cell.subject} / ${state.teacherMap[cell.teacherId]?.name || cell.teacherId || 'Unknown teacher'}` });
            }
            actualCounts[className][cell.subject] = (actualCounts[className][cell.subject] || 0) + 1;
          }
          const lock = lockedMap[`${className}|${day}|${slot.id}`];
          if (lock) {
            if (lock.type === 'fixed' && cell.type !== 'fixed') {
              lockedViolations.push({ title: 'Locked fixed block was changed', body: `${className} / ${day} / ${getSlotLabel(slot.id, slots)}` });
            }
            if (lock.type === 'teaching' && (!cell || cell.type !== 'teaching' || normalizeSubjectName(cell.subject) !== normalizeSubjectName(lock.subject) || String(cell.teacherId || '') !== String(lock.teacherId || ''))) {
              lockedViolations.push({ title: 'Locked teaching placement was changed', body: `${className} / ${day} / ${getSlotLabel(slot.id, slots)}` });
            }
          }
        });
      });
    });

    fixedIssues.forEach((issue) => lockedViolations.push(issue));
    Object.entries(settings.periodRequirements || {}).forEach(([className, bucket]) => {
      Object.entries(bucket || {}).forEach(([subject, required]) => {
        const actual = actualCounts[className]?.[subject] || 0;
        if (!(candidateMap[className]?.[subject] || []).length && required > 0) {
          missingTeachers.push({ title: 'No teacher can staff a required subject', body: `${className} / ${subject} requires ${required} period(s), but no configured teacher is assigned.` });
        }
        if (actual < required) {
          unscheduled.push({ title: 'Required periods are not fully scheduled', body: `${className} / ${subject}: scheduled ${actual} of ${required}.` });
        } else if (actual > required) {
          invalidPlacements.push({ title: 'Scheduled periods exceed requirement', body: `${className} / ${subject}: scheduled ${actual} of ${required}.` });
        }
      });
    });
    const summary = {
      collisions: collisions.length,
      unscheduled: unscheduled.length,
      missingTeachers: missingTeachers.length,
      invalidPlacements: invalidPlacements.length,
      lockedViolations: lockedViolations.length,
      isValid: !(collisions.length || unscheduled.length || missingTeachers.length || invalidPlacements.length || lockedViolations.length)
    };
    return { summary, collisions, unscheduled, missingTeachers, invalidPlacements, lockedViolations };
  }

  function buildGeneratedPayload(groupId, settings, teachers, engineResult, isSaved) {
    const validationSummary = { ...engineResult.validation.summary };
    return {
      groupId,
      year: state.year,
      schoolId: state.schoolId,
      schoolName: state.school?.name || state.schoolId,
      groupTitle: GROUPS[groupId].title,
      generatedAt: Date.now(),
      generatedBy: buildActor(),
      isValid: validationSummary.isValid,
      validationSummary,
      validation: engineResult.validation,
      teacherLegend: engineResult.teacherLegend,
      subjectLegend: engineResult.subjectLegend,
      slots: engineResult.slots,
      classes: engineResult.classes,
      days: DAYS,
      grid: engineResult.grid,
      collisions: engineResult.validation.collisions,
      missingTeachers: engineResult.validation.missingTeachers,
      unscheduled: engineResult.validation.unscheduled,
      invalidPlacements: engineResult.validation.invalidPlacements,
      lockedViolations: engineResult.validation.lockedViolations,
      sourceTeacherCount: teachers.length,
      sourceConfigHash: state.sourceConfigHash,
      status: validationSummary.isValid ? 'valid' : 'draft-invalid',
      isSaved: Boolean(isSaved)
    };
  }

  async function downloadCurrentGroupPdf() {
    const timetable = await ensureTimetableForExport(state.activeGroupId);
    if (!timetable) return;
    await exportTimetablesToPdf([state.activeGroupId], [timetable]);
  }

  async function downloadAllGroupsPdf() {
    const availableGroups = [];
    const timetables = [];
    for (const groupId of GROUP_ORDER) {
      const timetable = await ensureTimetableForExport(groupId);
      if (!timetable) continue;
      availableGroups.push(groupId);
      timetables.push(timetable);
    }
    if (!timetables.length) {
      toast('No timetable is available to export.', 'warning');
      return;
    }
    await exportTimetablesToPdf(availableGroups, timetables);
  }

  async function ensureTimetableForExport(groupId) {
    let timetable = getDisplayTimetable(groupId);
    if (timetable) return timetable;
    if (state.viewer.canManage) {
      timetable = await generateGroup(groupId, { saveMode: 'validOnly', silent: true, openPreview: false });
      return timetable;
    }
    toast(`${GROUPS[groupId].title} has no generated timetable yet.`, 'warning');
    return null;
  }

  async function exportTimetablesToPdf(groupIds, timetables) {
    const jsPdfLib = window.jspdf?.jsPDF;
    if (!jsPdfLib) {
      toast('jsPDF is missing on this page.', 'error');
      return;
    }
    const doc = new jsPdfLib({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const logoData = await loadImageDataUrl(state.schoolLogoUrl || FALLBACK_LOGO, FALLBACK_LOGO);
    groupIds.forEach((groupId, index) => {
      const timetable = timetables[index];
      if (index > 0) doc.addPage();
      drawPdfHeader(doc, logoData, groupId, timetable);
      const head = [['Day', 'Class', ...timetable.slots.map((slot) => `${slot.start}-${slot.end}`)]];
      const body = [];
      DAYS.forEach((day) => {
        timetable.classes.forEach((className, classIndex) => {
          const row = [classIndex === 0 ? day : '', className];
          timetable.slots.forEach((slot) => {
            const cell = timetable.grid?.[className]?.[day]?.[slot.id] || createEmptyCell(slot, day);
            row.push(cell.type === 'teaching' ? cell.code : (cell.type === 'fixed' ? (cell.label || 'Fixed') : 'OPEN'));
          });
          body.push(row);
        });
      });
      doc.autoTable({
        startY: 96,
        head,
        body,
        theme: 'grid',
        margin: { left: 18, right: 18, bottom: 78 },
        styles: { font: 'helvetica', fontSize: 7.15, cellPadding: 3, textColor: [16, 35, 62], lineColor: [100, 116, 139], lineWidth: 0.48, valign: 'middle', halign: 'center' },
        headStyles: { fillColor: [232, 240, 255], textColor: [36, 64, 100], fontStyle: 'bold', fontSize: 7.2, cellPadding: 3.1, lineWidth: 0.55 },
        columnStyles: {
          0: { fillColor: [245, 249, 255], fontStyle: 'bold', cellWidth: 42, halign: 'left' },
          1: { fillColor: [245, 249, 255], fontStyle: 'bold', cellWidth: 50, halign: 'left' }
        },
        didParseCell(data) {
          if (data.section === 'head') {
            data.cell.styles.valign = 'middle';
            return;
          }
          if (data.section !== 'body' || data.column.index < 2) return;
          const dayBlockIndex = Math.floor(data.row.index / timetable.classes.length);
          const day = DAYS[dayBlockIndex];
          const className = timetable.classes[data.row.index % timetable.classes.length];
          const slot = timetable.slots[data.column.index - 2];
          const cell = timetable.grid?.[className]?.[day]?.[slot.id] || createEmptyCell(slot, day);
          if (cell.type === 'teaching') {
            data.cell.styles.fillColor = hexToRgbArray(cell.color || '#dbeafe');
            data.cell.styles.fontStyle = 'bold';
          } else if (cell.type === 'fixed') {
            data.cell.styles.fillColor = [241, 245, 249];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.fillColor = [248, 250, 252];
            data.cell.styles.textColor = [148, 163, 184];
          }
        }
      });
      drawPdfLegend(doc, timetable, doc.internal.pageSize.getHeight() - 58);
    });
    doc.save(`${slugify(state.school?.name || state.schoolId || 'school')}_general_timetable_${state.year}.pdf`);
    noteExportAction('PDF downloaded');
  }

  function drawPdfHeader(doc, logoData, groupId, timetable) {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(248, 251, 255);
    doc.roundedRect(18, 16, pageWidth - 36, 60, 12, 12, 'F');
    if (logoData) {
      try { doc.addImage(logoData, 'PNG', 28, 24, 34, 34); } catch (error) {}
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(String(state.school?.name || state.schoolId || 'School'), 74, 36);
    doc.setFontSize(12);
    doc.text('GENERAL SCHOOL TIMETABLE', 74, 52);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Year ${state.year} | ${GROUPS[groupId].title}`, 74, 67);
    doc.text(`Generated ${formatDateTime(timetable.generatedAt)} | Downloaded ${formatDateTime(Date.now())}`, pageWidth - 278, 36);
    doc.text(`Validation: ${timetable.validationSummary.isValid ? 'Valid / Conflict free' : 'Contains issues'}`, pageWidth - 278, 52);
  }

  function drawPdfLegend(doc, timetable, startY) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let cursorY = Math.min(startY, pageHeight - 58);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.line(22, cursorY - 6, pageWidth - 22, cursorY - 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Teacher Legend', 26, cursorY);
    cursorY += 9;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    timetable.teacherLegend.forEach((teacher, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 26 + column * 262;
      const y = cursorY + row * 8;
      if (y <= pageHeight - 22) doc.text(`${teacher.number}. ${teacher.name} (${teacher.teacherType})`, x, y, { maxWidth: 232 });
    });
    const subjectY = Math.min(pageHeight - 12, cursorY + Math.ceil(timetable.teacherLegend.length / 3) * 8 + 10);
    doc.setFont('helvetica', 'bold');
    doc.text('Subject Legend', 26, subjectY);
    doc.setFont('helvetica', 'normal');
    const subjectLegendText = timetable.subjectLegend.map((item) => `${item.abbreviation}=${item.subject}`).join(' | ');
    const wrappedLegend = doc.splitTextToSize(subjectLegendText, pageWidth - 144).slice(0, 2);
    doc.text(wrappedLegend, 102, subjectY);
  }

  function printCurrentPreview() {
    setActiveTab('preview');
    noteExportAction('Printed');
    window.print();
  }

  function noteExportAction(actionLabel) {
    state.lastDownloadedAt = `${actionLabel} on ${formatDateTime(Date.now())}`;
    renderHeaderStatus(getDisplayTimetable(state.activeGroupId));
    renderPdfPanel();
  }

  async function loadImageDataUrl(url, fallbackUrl) {
    const preferred = await imageUrlToDataUrl(url).catch(() => null);
    if (preferred) return preferred;
    return imageUrlToDataUrl(fallbackUrl).catch(() => null);
  }

  function imageUrlToDataUrl(url) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('Image URL missing.'));
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function getDisplayTimetable(groupId) {
    const preview = state.previewByGroup[groupId];
    if (preview) return preview;
    const generated = state.generatedByGroup[groupId];
    return generated ? { ...generated, isSaved: true } : null;
  }

  function getSettingsForGroup(groupId) {
    return state.settingsByGroup[groupId] || normalizeSettings(null, groupId, state.teachers, state.subjectCatalog);
  }

  function getActiveSettings() {
    return getSettingsForGroup(state.activeGroupId);
  }

  function getTeachersForGroup(groupId) {
    const groupClasses = new Set(GROUPS[groupId].classes);
    return state.teachers.filter((teacher) => teacher.classSubjectMappings.some((mapping) => groupClasses.has(normalizeClassName(mapping.class))));
  }

  function getTeacherLegend(groupId, settings) {
    const source = getDisplayTimetable(groupId)?.teacherLegend;
    return source?.length ? source : buildTeacherLegend(groupId, settings, getTeachersForGroup(groupId));
  }

  function buildTeacherLegend(groupId, settings, teachers) {
    return teachers
      .map((teacher, index) => ({
        number: index + 1,
        workerId: teacher.workerId,
        name: teacher.name,
        teacherType: teacher.teacherType,
        classes: teacher.classes.filter((className) => GROUPS[groupId].classes.includes(className)),
        subjects: getTeacherSubjectsInGroup(teacher, groupId)
      }))
      .filter((teacher) => teacher.classes.length && teacher.subjects.length);
  }

  function buildSubjectLegend(groupId, settings) {
    return getSubjectsForGroup(groupId, settings).map((subject) => ({
      subject,
      abbreviation: settings.subjectAbbreviations?.[subject] || makeSubjectAbbreviation(subject),
      color: toColorHex(settings.subjectColors?.[subject] || DEFAULT_SUBJECT_COLORS[subject] || '#dbeafe')
    }));
  }

  function buildCandidateTeacherMap(groupId, teachers) {
    const map = {};
    GROUPS[groupId].classes.forEach((className) => {
      map[className] = {};
      getSubjectsForClass(groupId, className, getSettingsForGroup(groupId)).forEach((subject) => {
        map[className][subject] = teachers.filter((teacher) =>
          teacher.classSubjectMappings.some((mapping) =>
            normalizeClassName(mapping.class) === className &&
            (mapping.subjects || []).some((item) => normalizeSubjectName(item) === subject)
          )
        );
      });
    });
    return map;
  }

  function buildStaffingWarnings(groupId, settings) {
    const warnings = [];
    Object.entries(settings.periodRequirements || {}).forEach(([className, bucket]) => {
      Object.entries(bucket || {}).forEach(([subject, count]) => {
        if (count <= 0) return;
        if (!getCandidateTeachers(groupId, className, subject).length) {
          warnings.push({
            title: `${className} / ${subject} is not staffed`,
            body: `Required weekly periods are set to ${count}, but no teacher with completed setup is assigned to this class and subject.`
          });
        }
      });
    });
    return warnings;
  }

  function getTeacherSubjectsInGroup(teacher, groupId) {
    const groupClasses = new Set(GROUPS[groupId].classes);
    const subjects = new Set();
    teacher.classSubjectMappings.forEach((mapping) => {
      if (!groupClasses.has(normalizeClassName(mapping.class))) return;
      (mapping.subjects || []).forEach((subject) => subjects.add(normalizeSubjectName(subject)));
    });
    return Array.from(subjects);
  }

  function getCandidateTeachers(groupId, className, subject) {
    return getTeachersForGroup(groupId).filter((teacher) =>
      teacher.classSubjectMappings.some((mapping) =>
        normalizeClassName(mapping.class) === normalizeClassName(className) &&
        (mapping.subjects || []).some((item) => normalizeSubjectName(item) === normalizeSubjectName(subject))
      )
    );
  }

  function getSubjectsForGroup(groupId, settings) {
    const subjects = new Set();
    GROUPS[groupId].classes.forEach((className) => {
      getSubjectsForClass(groupId, className, settings).forEach((subject) => subjects.add(subject));
    });
    return Array.from(subjects).filter(Boolean).sort((left, right) => left.localeCompare(right));
  }

  function getSubjectsForClass(groupId, className, settings) {
    const subjects = new Set(SUBJECT_DEFAULTS[className] || []);
    Object.keys(state.subjectCatalog[className] || {}).forEach((subject) => subjects.add(subject));
    state.teachers.forEach((teacher) => {
      teacher.classSubjectMappings.forEach((mapping) => {
        if (normalizeClassName(mapping.class) !== normalizeClassName(className)) return;
        (mapping.subjects || []).forEach((subject) => subjects.add(normalizeSubjectName(subject)));
      });
    });
    Object.keys(settings.periodRequirements?.[className] || {}).forEach((subject) => subjects.add(normalizeSubjectName(subject)));
    return Array.from(subjects).filter(Boolean).sort((left, right) => left.localeCompare(right));
  }

  function normalizeSettings(raw, groupId, teachers, subjectCatalog) {
    const defaults = buildDefaultSettings(groupId, teachers, subjectCatalog);
    const input = raw && typeof raw === 'object' ? deepClone(raw) : {};
    const slots = normalizeSlots((input.slots || defaults.slots || []).map((slot, index) => ({
      id: slot.id || `${groupId}_slot_${index + 1}`,
      start: slot.start || '08:00',
      end: slot.end || '08:40',
      label: slot.label || `Slot ${index + 1}`,
      isTeaching: slot.isTeaching !== false
    })));
    const periodRequirements = {};
    GROUPS[groupId].classes.forEach((className) => {
      periodRequirements[className] = {};
      getSubjectsForClass(groupId, className, { periodRequirements: input.periodRequirements || defaults.periodRequirements || {} }).forEach((subject) => {
        const schemeHours = Number(state.schemeHoursByClass?.[className]?.[subject]?.hours || 0);
        const shouldPreferSeeded = !raw || Boolean(input.seededDefaults);
        const fallbackValue = shouldPreferSeeded && schemeHours > 0
          ? schemeHours
          : Number(defaults.periodRequirements?.[className]?.[subject] ?? 0);
        // Scheme hours (from Academic Materials) take precedence when a scheme exists for this class/subject
        const value = schemeHours > 0
          ? schemeHours
          : Number(input.periodRequirements?.[className]?.[subject] ?? fallbackValue);
        periodRequirements[className][subject] = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
      });
    });
    const subjectAbbreviations = {};
    const subjectColors = {};
    getSubjectsForGroup(groupId, { periodRequirements }).forEach((subject) => {
      subjectAbbreviations[subject] = sanitizeAbbreviation(input.subjectAbbreviations?.[subject] || defaults.subjectAbbreviations?.[subject] || makeSubjectAbbreviation(subject));
      subjectColors[subject] = toColorHex(input.subjectColors?.[subject] || defaults.subjectColors?.[subject] || DEFAULT_SUBJECT_COLORS[subject] || '#dbeafe');
    });
    return {
      groupId,
      classes: GROUPS[groupId].classes,
      slots,
      fixedBlocks: slots.filter((slot) => !slot.isTeaching).map((slot) => ({ slotId: slot.id, label: slot.label })),
      periodRequirements,
      subjectAbbreviations,
      subjectColors,
      lockedCells: normalizeLockedCells(input.lockedCells || []),
      seededDefaults: input.seededDefaults !== undefined ? Boolean(input.seededDefaults) : !raw,
      updatedAt: input.updatedAt || null,
      updatedBy: input.updatedBy || null
    };
  }

  function buildDefaultSettings(groupId, teachers, subjectCatalog) {
    const slots = deepClone(DEFAULT_SLOT_PRESETS[groupId] || []);
    const periodRequirements = {};
    const subjectAbbreviations = {};
    const subjectColors = {};
    GROUPS[groupId].classes.forEach((className) => {
      const subjects = new Set(SUBJECT_DEFAULTS[className] || []);
      Object.keys(subjectCatalog[className] || {}).forEach((subject) => subjects.add(subject));
      teachers.forEach((teacher) => {
        teacher.classSubjectMappings.forEach((mapping) => {
          if (normalizeClassName(mapping.class) !== className) return;
          (mapping.subjects || []).forEach((subject) => subjects.add(normalizeSubjectName(subject)));
        });
      });
      const preset = DEFAULT_PERIOD_PRESETS[groupId] || { default: 2, special: {} };
      periodRequirements[className] = {};
      Array.from(subjects).forEach((subject) => {
        const schemeHours = Number(state.schemeHoursByClass?.[className]?.[subject]?.hours || 0);
        periodRequirements[className][subject] = schemeHours > 0 ? schemeHours : (preset.special?.[subject] ?? preset.default ?? 2);
        subjectAbbreviations[subject] = DEFAULT_ABBREVIATIONS[subject] || makeSubjectAbbreviation(subject);
        subjectColors[subject] = DEFAULT_SUBJECT_COLORS[subject] || '#dbeafe';
      });
    });
    return { groupId, classes: GROUPS[groupId].classes, slots, periodRequirements, subjectAbbreviations, subjectColors, lockedCells: [], seededDefaults: true };
  }

  function normalizeGeneratedPayload(raw, groupId) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      ...raw,
      groupId,
      isSaved: true,
      slots: normalizeSlots(raw.slots || getSettingsForGroup(groupId).slots || []),
      validation: raw.validation || buildEmptyValidation(),
      validationSummary: raw.validationSummary || raw.validation?.summary || blankValidationSummary()
    };
  }

  function normalizeTeacherConfig(config) {
    const mappings = (config?.classSubjectMappings || [])
      .map((mapping) => ({
        class: normalizeClassName(mapping?.class),
        subjects: Array.from(new Set((mapping?.subjects || []).map(normalizeSubjectName).filter(Boolean)))
      }))
      .filter((mapping) => mapping.class && mapping.subjects.length);
    return {
      teacherType: compactTitleCase(config?.teacherType || ''),
      classSubjectMappings: mappings,
      classes: Array.from(new Set([...(config?.classes || []).map(normalizeClassName), ...mappings.map((mapping) => mapping.class)])).filter(Boolean),
      subjects: Array.from(new Set([...(config?.subjects || []).map(normalizeSubjectName), ...mappings.flatMap((mapping) => mapping.subjects || [])])).filter(Boolean),
      setupCompleted: config?.setupCompleted === true
    };
  }

  function normalizeSubjectCatalog(raw) {
    const catalog = {};
    Object.entries(raw || {}).forEach(([className, bucket]) => {
      const normalizedClass = normalizeClassName(className);
      if (!normalizedClass) return;
      catalog[normalizedClass] = catalog[normalizedClass] || {};
      const values = Array.isArray(bucket) ? bucket : Object.values(bucket || {});
      values.forEach((entry) => {
        const subject = normalizeSubjectName(typeof entry === 'string' ? entry : (entry?.label || entry?.name || ''));
        if (subject) catalog[normalizedClass][subject] = true;
      });
    });
    return catalog;
  }

  function normalizeLockedCells(list) {
    return (list || [])
      .map((cell) => ({
        id: cell.id || `lock_${Math.random().toString(16).slice(2, 8)}`,
        className: normalizeClassName(cell.className || cell.class),
        day: DAYS.includes(cell.day) ? cell.day : DAYS[0],
        slotId: String(cell.slotId || ''),
        type: cell.type === 'fixed' ? 'fixed' : 'teaching',
        subject: normalizeSubjectName(cell.subject || ''),
        teacherId: String(cell.teacherId || ''),
        label: String(cell.label || '')
      }))
      .filter((cell) => cell.className && cell.day && cell.slotId);
  }

  function normalizeSlots(slots) {
    return (slots || []).map((slot, index) => ({
      id: String(slot.id || `${slugify(slot.label || `slot_${index + 1}`)}_${index + 1}`),
      start: String(slot.start || '08:00'),
      end: String(slot.end || '08:40'),
      label: String(slot.label || `Slot ${index + 1}`),
      isTeaching: slot.isTeaching !== false
    }));
  }

  function createBaseGrid(classes, slots) {
    const grid = {};
    classes.forEach((className) => {
      grid[className] = {};
      DAYS.forEach((day) => {
        grid[className][day] = {};
        slots.forEach((slot) => {
          const fixedCell = getAutoFixedCell(slot, day);
          if (fixedCell) {
            grid[className][day][slot.id] = { ...fixedCell, slotId: slot.id };
          }
        });
      });
    });
    return grid;
  }

  function computeTeacherPotentialLoad(teacher, settings) {
    let load = 0;
    teacher.classSubjectMappings.forEach((mapping) => {
      const className = normalizeClassName(mapping.class);
      (mapping.subjects || []).forEach((subject) => {
        load += Number(settings.periodRequirements?.[className]?.[normalizeSubjectName(subject)] || 0);
      });
    });
    return load;
  }

  function computeTeacherScheduledLoad(workerId, timetable) {
    if (!timetable?.grid) return 0;
    let count = 0;
    Object.values(timetable.grid || {}).forEach((days) => {
      Object.values(days || {}).forEach((slots) => {
        Object.values(slots || {}).forEach((cell) => {
          if (cell?.type === 'teaching' && String(cell.teacherId || '') === String(workerId)) count += 1;
        });
      });
    });
    return count;
  }

  function computeDemandScore(demand) {
    let score = 0;
    Object.values(demand || {}).forEach((bucket) => {
      Object.values(bucket || {}).forEach((count) => { score += Math.max(0, Number(count) || 0); });
    });
    return score;
  }

  function cloneRequirementMap(input) {
    return JSON.parse(JSON.stringify(input || {}));
  }

  function countTeachingSlots(slots) {
    return (slots || []).filter((slot) => slot.isTeaching).length;
  }

  function sumPeriodRequirements(periodRequirements) {
    let total = 0;
    Object.values(periodRequirements || {}).forEach((bucket) => {
      Object.values(bucket || {}).forEach((count) => { total += Math.max(0, Number(count) || 0); });
    });
    return total;
  }

  function describeGeneratedFreshness(timetable) {
    if (!timetable) return 'No generated timetable available.';
    if (timetable.sourceConfigHash && timetable.sourceConfigHash !== state.sourceConfigHash) {
      return 'Saved timetable is older than the current teacher configuration.';
    }
    return timetable.isSaved ? 'Saved timetable matches the current teacher setup.' : 'Live preview uses the current source data.';
  }

  function blankValidationSummary() {
    return { collisions: 0, unscheduled: 0, missingTeachers: 0, invalidPlacements: 0, lockedViolations: 0, isValid: false };
  }

  function buildEmptyValidation() {
    return { summary: blankValidationSummary(), collisions: [], unscheduled: [], missingTeachers: [], invalidPlacements: [], lockedViolations: [] };
  }

  function flattenValidationIssues(validation) {
    const issues = [];
    (validation.collisions || []).forEach((item) => issues.push({ level: 'danger', title: item.title, body: item.body }));
    (validation.unscheduled || []).forEach((item) => issues.push({ level: 'warning', title: item.title, body: item.body }));
    (validation.missingTeachers || []).forEach((item) => issues.push({ level: 'danger', title: item.title, body: item.body }));
    (validation.invalidPlacements || []).forEach((item) => issues.push({ level: 'warning', title: item.title, body: item.body }));
    (validation.lockedViolations || []).forEach((item) => issues.push({ level: 'warning', title: item.title, body: item.body }));
    return issues;
  }

  function buildSourceConfigHash(source) {
    return hashString(stableStringify({
      schoolId: state.schoolId,
      year: state.year,
      teachers: source.teachers.map((teacher) => ({
        workerId: teacher.workerId,
        name: teacher.name,
        teacherType: teacher.teacherType,
        mappings: teacher.classSubjectMappings
      })),
      subjectCatalog: source.subjectCatalog,
      schemeHoursByClass: state.schemeHoursByClass
    }));
  }

  async function scopedOrSocratesLegacy(scopedPath, legacyPath) {
    try {
      const scopedSnap = await state.db.ref(window.SOMAP.P(scopedPath)).once('value');
      if (scopedSnap.exists()) return scopedSnap;
      if (isSocratesSchool(state.schoolId) && legacyPath && legacyPath !== scopedPath) {
        const legacySnap = await state.db.ref(legacyPath).once('value');
        if (legacySnap.exists()) return legacySnap;
      }
      return scopedSnap;
    } catch (error) {
      console.warn('Scoped read failed', scopedPath, error);
      return { exists: () => false, val: () => null };
    }
  }

  function resolveWorkerId() {
    const params = new URLSearchParams(window.location.search || '');
    const candidates = [localStorage.getItem('workerId'), sessionStorage.getItem('workerId'), params.get('workerId'), params.get('id')];
    const workerId = candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
    if (workerId) {
      localStorage.setItem('workerId', workerId);
      sessionStorage.setItem('workerId', workerId);
    }
    return workerId;
  }

  function buildActor() {
    return { workerId: state.workerId || '', name: state.viewer.name || 'Unknown', role: state.viewer.role || 'Teacher' };
  }

  function isSocratesSchool(value) {
    return ['socrates-school', 'default', 'socrates'].includes(String(value || '').trim().toLowerCase());
  }

  function getWorkerName(profile) {
    return String(profile?.fullNameUpper || profile?.fullName || [profile?.firstName, profile?.middleName, profile?.lastName].filter(Boolean).join(' ').trim() || '').trim();
  }

  function normalizeClassName(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    const compact = input.toLowerCase().replace(/[\s._-]+/g, '');
    if (compact.includes('baby')) return 'Baby Class';
    if (compact.includes('middle')) return 'Middle Class';
    if (compact.includes('preunit') || compact.includes('preunitclass') || compact.includes('pre') || compact.includes('nursery')) return 'Pre-Unit';
    const match = compact.match(/class([1-7])/);
    if (match) return `Class ${match[1]}`;
    const numeral = compact.match(/^([1-7])$/);
    if (numeral) return `Class ${numeral[1]}`;
    return input.replace(/\s+/g, ' ');
  }

  function normalizeSubjectName(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    const compact = input.toLowerCase().replace(/[\s._-]+/g, '');
    if (compact === 'healthcare' || compact === 'healtharec') return 'Health Care';
    return input.replace(/\s+/g, ' ');
  }

  function normalizeRole(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeYear(value) {
    const year = Number(value);
    if (!Number.isFinite(year)) return String(new Date().getFullYear());
    return String(Math.max(2024, Math.round(year)));
  }

  function compactTitleCase(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
  }

  function sanitizeAbbreviation(value) {
    const cleaned = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9&]/g, '');
    return cleaned || 'SUBJ';
  }

  function makeSubjectAbbreviation(subject) {
    return sanitizeAbbreviation(DEFAULT_ABBREVIATIONS[subject] || subject.split(/\s+/).map((part) => part.slice(0, 2)).join('').slice(0, 5));
  }

  function getSlotLabel(slotId, slots) {
    const slot = (slots || []).find((entry) => entry.id === slotId);
    return slot ? `${slot.start}-${slot.end} | ${slot.label}` : slotId;
  }

  function countUnusedSchedulableDays(searchState, className, subject) {
    let count = 0;
    DAYS.forEach((day) => {
      if ((searchState.classSubjectDayCount?.[className]?.[day]?.[subject] || 0) > 0) return;
      if (hasSchedulablePlacementOnDay(searchState, className, subject, day)) count += 1;
    });
    return count;
  }

  function hasSchedulablePlacementOnDay(searchState, className, subject, day) {
    return (searchState.candidateMap[className]?.[subject] || []).some((teacher) =>
      searchState.slots.some((slot) =>
        slot.isTeaching &&
        !searchState.grid[className][day][slot.id]?.type &&
        !searchState.teacherOccupancy[teacher.workerId]?.[day]?.[slot.id] &&
        (!isMorningPrioritySubject(subject) || slotEndsByNoon(slot))
      )
    );
  }

  function isMorningPrioritySubject(subject) {
    return MORNING_PRIORITY_SUBJECTS.has(normalizeSubjectName(subject));
  }

  function slotEndsByNoon(slot) {
    return parseTimeToMinutes(slot?.end) <= 12 * 60;
  }

  function isFridayAfternoonClosure(day, slot) {
    return day === 'Friday' && parseTimeToMinutes(slot?.start) >= 12 * 60 + 30;
  }

  function parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.POSITIVE_INFINITY;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function getAutoFixedCell(slot, day) {
    if (!slot) return null;
    if (!slot.isTeaching) return { type: 'fixed', label: slot.label, note: `${slot.start}-${slot.end}` };
    if (isFridayAfternoonClosure(day, slot)) return { type: 'fixed', label: 'Games / Talents', note: 'Friday afternoon' };
    return null;
  }

  function createEmptyCell(slot, day) {
    return getAutoFixedCell(slot, day) || { type: 'empty', label: 'Open' };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function hashString(value) {
    let hash = 0;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(index);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function indexBy(list, key) {
    return (list || []).reduce((acc, item) => {
      acc[item[key]] = item;
      return acc;
    }, {});
  }

  function setBusyStatus(message) {
    if (!els.generatedStatusBadge || !message) return;
    els.generatedStatusBadge.textContent = message;
    els.generatedStatusBadge.className = 'tt-pill tt-pill--neutral';
  }

  function toCamel(value) {
    return String(value || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function setText(element, value) {
    if (element) element.textContent = String(value ?? '');
  }

  function slugify(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
  }

  function toColorHex(value) {
    const raw = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#dbeafe';
  }

  function hexToRgbArray(hex) {
    const clean = toColorHex(hex).replace('#', '');
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  }

  function formatDateTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Not available';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  }

  function inputDisabled() {
    return state.viewer.canManage ? '' : 'disabled';
  }

  function renderAlert(alert) {
    return `<article class="tt-alert tt-alert--${escapeAttr(alert.type)}"><strong>${escapeHtml(alert.title)}</strong><div>${escapeHtml(alert.body)}</div></article>`;
  }

  function toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const item = document.createElement('div');
    item.className = `tt-toast tt-toast--${type}`;
    item.textContent = message;
    container.appendChild(item);
    window.setTimeout(() => item.remove(), 3600);
  }

})();
