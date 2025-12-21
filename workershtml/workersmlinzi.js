const { createElement: h, useEffect, useMemo, useState } = React;

const TZ = 'Africa/Nairobi';
const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat('sw-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

function todayYMD(date = new Date()) {
  return fmtDate.format(date);
}

function niceTime(value) {
  if (!value) return '';
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  return fmtTime.format(new Date(ts));
}

function toast(message, type = 'info', timeoutMs = 4200) {
  const host = document.querySelector('.workers-toast-host') || document.body.appendChild(document.createElement('div'));
  host.className = 'workers-toast-host';
  const el = document.createElement('div');
  el.className = `workers-toast workers-toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, timeoutMs);
}

function readSession() {
  const workerId = localStorage.getItem('workerId') || sessionStorage.getItem('workerId') || '';
  const workerRole = localStorage.getItem('workerRole') || sessionStorage.getItem('workerRole') || '';
  const workerName = localStorage.getItem('workerName') || localStorage.getItem('fullName') || '';
  const schoolId =
    localStorage.getItem('somap.currentSchoolId') ||
    localStorage.getItem('schoolId') ||
    window.currentSchoolId ||
    '';
  if (schoolId) window.currentSchoolId = schoolId;
  return { workerId, workerRole, workerName, schoolId };
}

function withSchool(path, schoolId) {
  return schoolId ? `schools/${schoolId}/${path}` : path;
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return todayYMD(d);
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayYMD(d);
}

function humanDate(ymd) {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('sw-KE', { weekday: 'short', day: '2-digit', month: 'short' });
}

function App() {
  const [session, setSession] = useState(readSession());
  const [workerProfile, setWorkerProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('shift');
  const [todayKey, setTodayKey] = useState(todayYMD());
  const [now, setNow] = useState(new Date());

  const [shiftType, setShiftType] = useState('morning');
  const [handoverFrom, setHandoverFrom] = useState('');
  const [handoverTo, setHandoverTo] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftRecord, setShiftRecord] = useState(null);

  const [tripForm, setTripForm] = useState({
    workerName: '',
    destination: '',
    expectedReturn: '',
    approvedBy: '',
    reason: ''
  });
  const [trips, setTrips] = useState({});

  const [visitorForm, setVisitorForm] = useState({
    name: '',
    phone: '',
    purpose: '',
    host: '',
    from: ''
  });
  const [visitors, setVisitors] = useState({});

  const [assetForm, setAssetForm] = useState({
    id: '',
    name: '',
    location: '',
    qty: '',
    damaged: '',
    lost: '',
    notes: ''
  });
  const [assets, setAssets] = useState([]);

  const [equipForm, setEquipForm] = useState({
    id: '',
    name: '',
    qtyHave: '',
    qtyNeed: '',
    price: ''
  });
  const [equipment, setEquipment] = useState([]);

  const [weekStart, setWeekStart] = useState(getMonday());
  const [loadingDay, setLoadingDay] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);

  useEffect(() => {
    if (!session.workerId) {
      toast('Ingia upya kama mlinzi.', 'error');
      window.location.href = '../index.html';
      return;
    }
    loadProfile(session.workerId);
    loadDayData(todayKey);
    loadAssets();
    loadEquipment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.workerId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000 * 60);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    loadDayData(todayKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, shiftType, session.schoolId]);

  useEffect(() => {
    if (workerProfile?.schoolId && !session.schoolId) {
      setSession(prev => ({ ...prev, schoolId: workerProfile.schoolId }));
      window.currentSchoolId = workerProfile.schoolId;
    }
  }, [workerProfile, session.schoolId]);

  const resolvedSchoolId = session.schoolId || workerProfile?.schoolId || window.currentSchoolId || '';
  const kpi = useMemo(() => {
    const tripList = Object.values(trips || {});
    const visitorList = Object.values(visitors || {});
    return {
      tripsOut: tripList.filter(t => t.status !== 'returned').length,
      visitorsIn: visitorList.filter(v => v.status !== 'out').length,
      tripsToday: tripList.length,
      visitorsToday: visitorList.length
    };
  }, [trips, visitors]);

  async function loadProfile(workerId) {
    try {
      const snap = await firebase.database().ref(`workers/${workerId}/profile`).once('value');
      if (snap.exists()) setWorkerProfile(snap.val());
    } catch (err) {
      console.error(err);
      toast('Imeshindikana kusoma taarifa zako.', 'warning');
    }
  }

  async function loadDayData(dateKey) {
    setLoadingDay(true);
    try {
      await Promise.all([loadShift(dateKey, shiftType), loadTrips(dateKey), loadVisitors(dateKey)]);
    } catch (err) {
      console.error(err);
      toast('Imeshindikana kupakia data ya leo.', 'error');
    } finally {
      setLoadingDay(false);
    }
  }

  function securityBase(year = new Date().getFullYear()) {
    return withSchool(`security/${year}`, resolvedSchoolId);
  }

  async function loadShift(dateKey, type) {
    const year = new Date(`${dateKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/shifts/${dateKey}/${type}`);
    const snap = await ref.once('value');
    if (snap.exists()) {
      const data = snap.val();
      setShiftRecord(data);
      setHandoverFrom(data.handoverFrom || '');
      setHandoverTo(data.handoverTo || '');
      setShiftNotes(data.notes || '');
    } else {
      setShiftRecord(null);
      setShiftNotes('');
      setHandoverFrom('');
      setHandoverTo('');
    }
  }

  async function saveShift(action) {
    if (!shiftType) {
      toast('Chagua aina ya shift.', 'warning');
      return;
    }
    const year = new Date(`${todayKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/shifts/${todayKey}/${shiftType}`);
    const payload = {
      shiftType,
      guardId: session.workerId,
      guardName: workerProfile?.fullName || workerProfile?.name || session.workerName || 'Mlinzi',
      schoolId: resolvedSchoolId || null,
      notes: shiftNotes.trim(),
      handoverFrom,
      handoverTo,
      updatedAt: Date.now()
    };
    if (action === 'start') {
      payload.startTime = Date.now();
      payload.status = 'active';
    } else {
      payload.endTime = Date.now();
      payload.status = 'complete';
    }
    await ref.update(payload);
    setShiftRecord(prev => ({ ...(prev || {}), ...payload }));
    toast(action === 'start' ? 'Shift imeanza.' : 'Handover imerekodiwa.', 'success');
  }

  async function loadTrips(dateKey) {
    const year = new Date(`${dateKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/gate/workers/${dateKey}`);
    const snap = await ref.once('value');
    setTrips(snap.exists() ? snap.val() : {});
  }

  async function loadVisitors(dateKey) {
    const year = new Date(`${dateKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/gate/visitors/${dateKey}`);
    const snap = await ref.once('value');
    setVisitors(snap.exists() ? snap.val() : {});
  }

  async function saveTrip() {
    if (!tripForm.workerName || !tripForm.destination) {
      toast('Andika jina na anakoenda.', 'warning');
      return;
    }
    const year = new Date(`${todayKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/gate/workers/${todayKey}`).push();
    const record = {
      id: ref.key,
      workerName: tripForm.workerName,
      destination: tripForm.destination,
      expectedReturn: tripForm.expectedReturn,
      approvedBy: tripForm.approvedBy,
      reason: tripForm.reason,
      status: 'out',
      outAt: Date.now(),
      createdBy: session.workerId,
      createdByName: workerProfile?.fullName || session.workerName || ''
    };
    await ref.set(record);
    setTripForm({ workerName: '', destination: '', expectedReturn: '', approvedBy: '', reason: '' });
    loadTrips(todayKey);
    toast('Safari imehifadhiwa.', 'success');
  }

  async function markReturned(id) {
    if (!id) return;
    const year = new Date(`${todayKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/gate/workers/${todayKey}/${id}`);
    await ref.update({ status: 'returned', returnedAt: Date.now() });
    loadTrips(todayKey);
    toast('Imerejeshwa.', 'success');
  }

  async function saveVisitor() {
    if (!visitorForm.name || !visitorForm.purpose) {
      toast('Jina na sababu vinahitajika.', 'warning');
      return;
    }
    const year = new Date(`${todayKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/gate/visitors/${todayKey}`).push();
    const record = {
      id: ref.key,
      name: visitorForm.name,
      phone: visitorForm.phone,
      purpose: visitorForm.purpose,
      host: visitorForm.host,
      from: visitorForm.from,
      status: 'in',
      inAt: Date.now(),
      createdBy: session.workerId
    };
    await ref.set(record);
    setVisitorForm({ name: '', phone: '', purpose: '', host: '', from: '' });
    loadVisitors(todayKey);
    toast('Mgeni ameingia.', 'success');
  }

  async function markVisitorOut(id) {
    if (!id) return;
    const year = new Date(`${todayKey}T12:00:00`).getFullYear();
    const ref = firebase.database().ref(`${securityBase(year)}/gate/visitors/${todayKey}/${id}`);
    await ref.update({ status: 'out', outAt: Date.now() });
    loadVisitors(todayKey);
    toast('Mgeni ametoka.', 'success');
  }

  async function loadAssets() {
    setLoadingAssets(true);
    try {
      const year = new Date().getFullYear();
      const ref = firebase.database().ref(`${securityBase(year)}/assets/items`);
      const snap = await ref.once('value');
      const list = snap.exists()
        ? Object.entries(snap.val()).map(([id, data]) => ({ id, ...(data || {}) }))
        : [];
      setAssets(list);
    } catch (err) {
      console.error(err);
      toast('Imeshindikana kupakia mali.', 'warning');
    } finally {
      setLoadingAssets(false);
    }
  }

  async function saveAsset() {
    if (!assetForm.name) {
      toast('Weka jina la mali.', 'warning');
      return;
    }
    const year = new Date().getFullYear();
    const ref = assetForm.id
      ? firebase.database().ref(`${securityBase(year)}/assets/items/${assetForm.id}`)
      : firebase.database().ref(`${securityBase(year)}/assets/items`).push();
    await ref.update({
      name: assetForm.name,
      location: assetForm.location,
      qty: parseNumber(assetForm.qty),
      damaged: parseNumber(assetForm.damaged),
      lost: parseNumber(assetForm.lost),
      notes: assetForm.notes,
      updatedAt: Date.now(),
      updatedBy: session.workerId
    });
    setAssetForm({ id: '', name: '', location: '', qty: '', damaged: '', lost: '', notes: '' });
    loadAssets();
    toast('Mali imehifadhiwa.', 'success');
  }

  async function loadEquipment() {
    try {
      const year = new Date().getFullYear();
      const ref = firebase.database().ref(`${securityBase(year)}/equipment/items`);
      const snap = await ref.once('value');
      const list = snap.exists()
        ? Object.entries(snap.val()).map(([id, data]) => ({ id, ...(data || {}) }))
        : [];
      setEquipment(list);
    } catch (err) {
      console.error(err);
      toast('Imeshindikana kupakia vifaa.', 'warning');
    }
  }

  async function saveEquipment() {
    if (!equipForm.name) {
      toast('Weka jina la kifaa.', 'warning');
      return;
    }
    const year = new Date().getFullYear();
    const ref = equipForm.id
      ? firebase.database().ref(`${securityBase(year)}/equipment/items/${equipForm.id}`)
      : firebase.database().ref(`${securityBase(year)}/equipment/items`).push();
    await ref.update({
      name: equipForm.name,
      qtyHave: parseNumber(equipForm.qtyHave),
      qtyNeed: parseNumber(equipForm.qtyNeed),
      price: parseNumber(equipForm.price),
      updatedAt: Date.now(),
      updatedBy: session.workerId
    });
    setEquipForm({ id: '', name: '', qtyHave: '', qtyNeed: '', price: '' });
    loadEquipment();
    toast('Kifaa kimesasishwa.', 'success');
  }

  async function generateWeeklyPdf() {
    if (!window.jspdf?.jsPDF || !window.jspdf?.autoTable) {
      toast('PDF tools hazijapakiwa.', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    const dates = [0, 1, 2, 3, 4].map(i => addDays(weekStart, i));
    const workerRows = [];
    const visitorRows = [];

    for (const dateKey of dates) {
      const year = new Date(`${dateKey}T12:00:00`).getFullYear();
      const base = securityBase(year);
      // Worker trips
      const tripSnap = await firebase.database().ref(`${base}/gate/workers/${dateKey}`).once('value');
      const tripMap = tripSnap.exists() ? tripSnap.val() : {};
      Object.values(tripMap).forEach(rec => {
        workerRows.push([
          humanDate(dateKey),
          rec.workerName || '',
          rec.destination || '',
          rec.reason || '',
          rec.approvedBy || '',
          rec.expectedReturn || '',
          niceTime(rec.outAt),
          niceTime(rec.returnedAt) || (rec.status === 'returned' ? 'Imerejeshwa' : 'Bado')
        ]);
      });
      // Visitors
      const visSnap = await firebase.database().ref(`${base}/gate/visitors/${dateKey}`).once('value');
      const visMap = visSnap.exists() ? visSnap.val() : {};
      Object.values(visMap).forEach(rec => {
        visitorRows.push([
          humanDate(dateKey),
          rec.name || '',
          rec.phone || '',
          rec.purpose || '',
          rec.host || '',
          niceTime(rec.inAt),
          niceTime(rec.outAt) || (rec.status === 'out' ? 'Imetoka' : 'Bado')
        ]);
      });
    }

    const doc = new jsPDF();
    doc.text('Ripoti ya Ulinzi - Wiki', 14, 16);
    doc.text(`Wiki: ${humanDate(dates[0])} hadi ${humanDate(dates[4])}`, 14, 24);
    doc.autoTable({
      startY: 30,
      head: [['Siku', 'Mfanyakazi', 'Anaenda wapi', 'Sababu', 'Ruhusa ya', 'Atarudi saa', 'Alienda', 'Alirudi']],
      body: workerRows.length ? workerRows : [['-', '-', '-', '-', '-', '-', '-', '-']],
      styles: { fontSize: 8 }
    });
    const nextY = doc.lastAutoTable.finalY + 10;
    doc.autoTable({
      startY: nextY,
      head: [['Siku', 'Mgeni', 'Simu', 'Sababu', 'Anayemtembelea', 'Aliingia', 'Ametoka']],
      body: visitorRows.length ? visitorRows : [['-', '-', '-', '-', '-', '-', '-']],
      styles: { fontSize: 8 }
    });
    doc.save(`ulinzi-${weekStart}-report.pdf`);
    toast('PDF imetengenezwa.', 'success');
  }

  function shiftStatusBadge() {
    if (!shiftRecord) return h('span', { className: 'status-badge status-missing' }, 'Bado hujaanza');
    if (shiftRecord.status === 'complete') return h('span', { className: 'status-badge status-ok' }, 'Imekabidhiwa');
    return h('span', { className: 'status-badge status-pending' }, 'Inaendelea');
  }

  function renderTabs() {
    const tabs = [
      { id: 'shift', label: 'Shift' },
      { id: 'gate', label: 'Wafanyakazi' },
      { id: 'visitors', label: 'Wageni' },
      { id: 'assets', label: 'Mali' },
      { id: 'equipment', label: 'Vifaa' },
      { id: 'report', label: 'Ripoti PDF' }
    ];
    return h('div', { className: 'tab-strip' },
      tabs.map(tab =>
        h('button', {
          key: tab.id,
          className: `tab-btn${activeTab === tab.id ? ' active' : ''}`,
          onClick: () => setActiveTab(tab.id)
        }, tab.label)
      )
    );
  }

  function renderHero() {
    return h('section', { className: 'hero-card workers-card' }, [
      h('div', { className: 'hero-meta' }, [
        h('p', { className: 'eyebrow' }, 'Mlinzi Hub'),
        h('h1', null, workerProfile?.fullName || workerProfile?.name || session.workerName || 'Mlinzi'),
        h('p', { className: 'workers-card__subtitle' },
          `Shule: ${resolvedSchoolId || 'Haijawekwa'} • Mwaka ${new Date().getFullYear()} • Saa ${fmtTime.format(now)}`)
      ]),
      h('div', { className: 'kpi-grid' }, [
        h('div', { className: 'kpi-card info' }, [
          h('h3', null, 'Wafanyakazi nje sasa'),
          h('p', { className: 'value' }, kpi.tripsOut)
        ]),
        h('div', { className: 'kpi-card success' }, [
          h('h3', null, 'Wageni ndani sasa'),
          h('p', { className: 'value' }, kpi.visitorsIn)
        ]),
        h('div', { className: 'kpi-card warning' }, [
          h('h3', null, 'Safari za leo'),
          h('p', { className: 'value' }, kpi.tripsToday)
        ]),
        h('div', { className: 'kpi-card danger' }, [
          h('h3', null, 'Wageni wa leo'),
          h('p', { className: 'value' }, kpi.visitorsToday)
        ])
      ])
    ]);
  }

  function renderShift() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header space-between' }, [
        h('div', null, [
          h('h2', null, 'Shift & Handover'),
          h('p', { className: 'workers-card__subtitle' }, 'Anza shift, andika makabidhiano na dokezo fupi.')
        ]),
        shiftStatusBadge()
      ]),
      h('div', { className: 'workers-grid' }, [
        h('label', null, [
          'Aina ya shift',
          h('select', { value: shiftType, onChange: e => setShiftType(e.target.value) }, [
            h('option', { value: 'morning' }, 'Morning'),
            h('option', { value: 'evening' }, 'Evening'),
            h('option', { value: 'night' }, 'Night')
          ])
        ]),
        h('label', null, [
          'Kupokea kutoka (jina)',
          h('input', { value: handoverFrom, onChange: e => setHandoverFrom(e.target.value) })
        ]),
        h('label', null, [
          'Kukabidhi kwa (jina)',
          h('input', { value: handoverTo, onChange: e => setHandoverTo(e.target.value) })
        ]),
        h('label', null, [
          'Dokezo la shift',
          h('textarea', {
            rows: 3,
            value: shiftNotes,
            onChange: e => setShiftNotes(e.target.value)
          })
        ])
      ]),
      h('div', { className: 'workers-card__actions' }, [
        h('button', { className: 'workers-btn success', onClick: () => saveShift('start'), disabled: loadingDay }, 'Anza Shift'),
        h('button', { className: 'workers-btn primary', onClick: () => saveShift('handover'), disabled: loadingDay }, 'Kamilisha / Handover')
      ]),
      shiftRecord
        ? h('div', { className: 'mini-list' }, [
            h('div', { className: 'mini-list__item' }, [
              h('span', null, 'Ilianza'),
              h('span', { className: 'mini-list__meta' }, niceTime(shiftRecord.startTime))
            ]),
            h('div', { className: 'mini-list__item' }, [
              h('span', null, 'Imekamilika'),
              h('span', { className: 'mini-list__meta' }, niceTime(shiftRecord.endTime) || 'Bado')
            ]),
            shiftRecord.notes ? h('p', { className: 'workers-card__subtitle' }, shiftRecord.notes) : null
          ])
        : null
    ]);
  }

  function renderGate() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header space-between' }, [
        h('div', null, [
          h('h2', null, 'Geti: Wafanyakazi'),
          h('p', { className: 'workers-card__subtitle' }, 'Andika wanaotoka, wanaenda wapi, na watarudi saa ngapi.')
        ]),
        h('label', { className: 'workers-chip' }, [
          'Tarehe ',
          h('input', { type: 'date', value: todayKey, onChange: e => setTodayKey(e.target.value || todayYMD()) })
        ])
      ]),
      h('div', { className: 'workers-grid' }, [
        h('label', null, [
          'Jina la mfanyakazi',
          h('input', { value: tripForm.workerName, onChange: e => setTripForm({ ...tripForm, workerName: e.target.value }) })
        ]),
        h('label', null, [
          'Anaenda wapi',
          h('input', { value: tripForm.destination, onChange: e => setTripForm({ ...tripForm, destination: e.target.value }) })
        ]),
        h('label', null, [
          'Sababu / kazi',
          h('input', { value: tripForm.reason, onChange: e => setTripForm({ ...tripForm, reason: e.target.value }) })
        ]),
        h('label', null, [
          'Atarudi saa',
          h('input', { type: 'time', value: tripForm.expectedReturn, onChange: e => setTripForm({ ...tripForm, expectedReturn: e.target.value }) })
        ]),
        h('label', null, [
          'Ruhusa ya nani',
          h('input', { value: tripForm.approvedBy, onChange: e => setTripForm({ ...tripForm, approvedBy: e.target.value }) })
        ])
      ]),
      h('div', { className: 'workers-card__actions' }, [
        h('button', { className: 'workers-btn primary', onClick: saveTrip, disabled: loadingDay }, 'Rekodi Safari')
      ]),
      h('div', { className: 'mini-list' },
        Object.values(trips || {}).length
          ? Object.values(trips).map(rec =>
              h('div', { key: rec.id, className: 'mini-list__item trip-row' }, [
                h('div', null, [
                  h('strong', null, rec.workerName || 'Bila jina'),
                  h('p', { className: 'workers-card__subtitle' }, `${rec.destination || '-'} • Ruhusa: ${rec.approvedBy || '-'}`)
                ]),
                h('div', { className: 'trip-meta' }, [
                  h('span', { className: 'workers-chip' }, rec.status === 'returned' ? 'Imerejea' : 'Nje'),
                  h('small', null, `Alienda: ${niceTime(rec.outAt)}`),
                  h('small', null, `Atarudi: ${rec.expectedReturn || '-'}`)
                ]),
                rec.status === 'returned'
                  ? h('span', { className: 'mini-list__meta' }, niceTime(rec.returnedAt))
                  : h('button', { className: 'workers-btn success', onClick: () => markReturned(rec.id) }, 'Rudi')
              ])
            )
          : h('p', { className: 'workers-card__subtitle' }, 'Hakuna safari za leo.')
      )
    ]);
  }

  function renderVisitors() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header space-between' }, [
        h('div', null, [
          h('h2', null, 'Wageni'),
          h('p', { className: 'workers-card__subtitle' }, 'Sajili wanaoingia, kisha tandika watokapo.')
        ]),
        h('label', { className: 'workers-chip' }, [
          'Tarehe ',
          h('input', { type: 'date', value: todayKey, onChange: e => setTodayKey(e.target.value || todayYMD()) })
        ])
      ]),
      h('div', { className: 'workers-grid' }, [
        h('label', null, [
          'Jina la mgeni',
          h('input', { value: visitorForm.name, onChange: e => setVisitorForm({ ...visitorForm, name: e.target.value }) })
        ]),
        h('label', null, [
          'Simu',
          h('input', { value: visitorForm.phone, onChange: e => setVisitorForm({ ...visitorForm, phone: e.target.value }) })
        ]),
        h('label', null, [
          'Kutoka wapi',
          h('input', { value: visitorForm.from, onChange: e => setVisitorForm({ ...visitorForm, from: e.target.value }) })
        ]),
        h('label', null, [
          'Sababu',
          h('input', { value: visitorForm.purpose, onChange: e => setVisitorForm({ ...visitorForm, purpose: e.target.value }) })
        ]),
        h('label', null, [
          'Anaenda kwa nani',
          h('input', { value: visitorForm.host, onChange: e => setVisitorForm({ ...visitorForm, host: e.target.value }) })
        ])
      ]),
      h('div', { className: 'workers-card__actions' }, [
        h('button', { className: 'workers-btn primary', onClick: saveVisitor, disabled: loadingDay }, 'Mgeni Ameingia')
      ]),
      h('div', { className: 'mini-list' },
        Object.values(visitors || {}).length
          ? Object.values(visitors).map(rec =>
              h('div', { key: rec.id, className: 'mini-list__item trip-row' }, [
                h('div', null, [
                  h('strong', null, rec.name || 'Mgeni'),
                  h('p', { className: 'workers-card__subtitle' }, `${rec.purpose || '-'} • Mwenyeji: ${rec.host || '-'}`)
                ]),
                h('div', { className: 'trip-meta' }, [
                  h('span', { className: 'workers-chip' }, rec.status === 'out' ? 'Ametoka' : 'Ndani'),
                  h('small', null, `Aliingia: ${niceTime(rec.inAt)}`)
                ]),
                rec.status === 'out'
                  ? h('span', { className: 'mini-list__meta' }, niceTime(rec.outAt) || 'Imetoka')
                  : h('button', { className: 'workers-btn success', onClick: () => markVisitorOut(rec.id) }, 'Mgeni Ametoka')
              ])
            )
          : h('p', { className: 'workers-card__subtitle' }, 'Hakuna wageni leo.')
      )
    ]);
  }

  function renderAssets() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header space-between' }, [
        h('div', null, [
          h('h2', null, 'Mali'),
          h('p', { className: 'workers-card__subtitle' }, 'Mahali zilipo, zilizopo, zilizoharibika au kupotea.')
        ]),
        loadingAssets ? h('span', { className: 'status-badge status-pending' }, 'Inapakia') : null
      ]),
      h('div', { className: 'workers-grid' }, [
        h('label', null, [
          'Jina la mali',
          h('input', { value: assetForm.name, onChange: e => setAssetForm({ ...assetForm, name: e.target.value }) })
        ]),
        h('label', null, [
          'Eneo / chumba',
          h('input', { value: assetForm.location, onChange: e => setAssetForm({ ...assetForm, location: e.target.value }) })
        ]),
        h('label', null, [
          'Kiasi kilichopo',
          h('input', { type: 'number', value: assetForm.qty, onChange: e => setAssetForm({ ...assetForm, qty: e.target.value }) })
        ]),
        h('label', null, [
          'Kilichoharibika',
          h('input', { type: 'number', value: assetForm.damaged, onChange: e => setAssetForm({ ...assetForm, damaged: e.target.value }) })
        ]),
        h('label', null, [
          'Kilichopotea',
          h('input', { type: 'number', value: assetForm.lost, onChange: e => setAssetForm({ ...assetForm, lost: e.target.value }) })
        ]),
        h('label', null, [
          'Maelezo',
          h('textarea', { rows: 2, value: assetForm.notes, onChange: e => setAssetForm({ ...assetForm, notes: e.target.value }) })
        ])
      ]),
      h('div', { className: 'workers-card__actions' }, [
        h('button', { className: 'workers-btn primary', onClick: saveAsset }, assetForm.id ? 'Sasisha Mali' : 'Ongeza Mali'),
        assetForm.id ? h('button', { className: 'workers-btn secondary', onClick: () => setAssetForm({ id: '', name: '', location: '', qty: '', damaged: '', lost: '', notes: '' }) }, 'Weka upya') : null
      ]),
      h('div', { className: 'mini-list' },
        assets.length
          ? assets.map(item =>
              h('div', { key: item.id, className: 'mini-list__item', onClick: () => setAssetForm({ ...item, id: item.id }) }, [
                h('div', null, [
                  h('strong', null, item.name),
                  h('p', { className: 'workers-card__subtitle' }, item.location || 'Haijawekwa')
                ]),
                h('div', { className: 'mini-list__meta' }, `Zipo ${item.qty || 0} • Haribika ${item.damaged || 0} • Zimepotea ${item.lost || 0}`)
              ])
            )
          : h('p', { className: 'workers-card__subtitle' }, 'Ongeza mali ya kwanza.')
      )
    ]);
  }

  function renderEquipment() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header space-between' }, [
        h('div', null, [
          h('h2', null, 'Vifaa vya Ulinzi'),
          h('p', { className: 'workers-card__subtitle' }, 'Kiasi kilicho nao, kinachohitajika na makadirio ya bei.')
        ])
      ]),
      h('div', { className: 'workers-grid' }, [
        h('label', null, [
          'Kifaa / item',
          h('input', { value: equipForm.name, onChange: e => setEquipForm({ ...equipForm, name: e.target.value }) })
        ]),
        h('label', null, [
          'Kiasi kilicho nao',
          h('input', { type: 'number', value: equipForm.qtyHave, onChange: e => setEquipForm({ ...equipForm, qtyHave: e.target.value }) })
        ]),
        h('label', null, [
          'Kiasi kinachohitajika',
          h('input', { type: 'number', value: equipForm.qtyNeed, onChange: e => setEquipForm({ ...equipForm, qtyNeed: e.target.value }) })
        ]),
        h('label', null, [
          'Makadirio ya bei',
          h('input', { type: 'number', value: equipForm.price, onChange: e => setEquipForm({ ...equipForm, price: e.target.value }) })
        ])
      ]),
      h('div', { className: 'workers-card__actions' }, [
        h('button', { className: 'workers-btn primary', onClick: saveEquipment }, equipForm.id ? 'Sasisha Kifaa' : 'Ongeza Kifaa'),
        equipForm.id ? h('button', { className: 'workers-btn secondary', onClick: () => setEquipForm({ id: '', name: '', qtyHave: '', qtyNeed: '', price: '' }) }, 'Weka upya') : null
      ]),
      h('div', { className: 'mini-list' },
        equipment.length
          ? equipment.map(item =>
              h('div', { key: item.id, className: 'mini-list__item', onClick: () => setEquipForm({ ...item, id: item.id }) }, [
                h('div', null, [
                  h('strong', null, item.name),
                  h('p', { className: 'workers-card__subtitle' }, `Navy ${item.qtyHave || 0} • Nahitaji ${item.qtyNeed || 0}`)
                ]),
                h('div', { className: 'mini-list__meta' }, item.price ? `Makadirio: ${item.price}` : 'Bei haijawekwa')
              ])
            )
          : h('p', { className: 'workers-card__subtitle' }, 'Ongeza vifaa vya ulinzi.')
      )
    ]);
  }

  function renderReport() {
    return h('section', { className: 'workers-card' }, [
      h('header', { className: 'workers-card__header' }, [
        h('h2', null, 'Ripoti ya Wiki (Mon–Fri)'),
        h('p', { className: 'workers-card__subtitle' }, 'PDF ya safari za wafanyakazi na wageni kwa wiki.')
      ]),
      h('div', { className: 'workers-grid' }, [
        h('label', null, [
          'Wiki inaanza lini (Jumatatu)',
          h('input', { type: 'date', value: weekStart, onChange: e => setWeekStart(e.target.value || getMonday()) })
        ])
      ]),
      h('div', { className: 'workers-card__actions' }, [
        h('button', { className: 'workers-btn primary', onClick: generateWeeklyPdf }, 'Pakua PDF')
      ])
    ]);
  }

  function renderActiveTab() {
    switch (activeTab) {
      case 'gate':
        return renderGate();
      case 'visitors':
        return renderVisitors();
      case 'assets':
        return renderAssets();
      case 'equipment':
        return renderEquipment();
      case 'report':
        return renderReport();
      default:
        return renderShift();
    }
  }

  return h('main', { className: 'workers-main' }, [
    renderHero(),
    renderTabs(),
    loadingDay ? h('p', { className: 'workers-card__subtitle' }, 'Inapakia...') : null,
    renderActiveTab()
  ]);
}

const rootEl = document.getElementById('app');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(h(App));
}
