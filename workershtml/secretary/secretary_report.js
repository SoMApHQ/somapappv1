// Secretary Desk — work report for a day, week, month or year.
//
// Rebuilds what the secretary did on every working day (Mon–Fri) of the period
// straight from the source records, so the report is right even for days the
// secretary never checked out:
//   worker check-in/out        years/{Y}/workerAttendance/{workerId}/{YYYYMM}  (Socrates legacy: attendance/…)
//   Preform One attendance     schools/Socrates School Preform one/{Y}/students/*/attendance
//   MAU / MAP attendance       schools/{id}/attendance/{class}/{YYYY-MM}/{date}
//   MAU / MAP expenses         schools/{id}/years/{Y}/expenseApprovals
//   graduation calls           schools/{home}/graduation/{Y}/secretaryCalls
//   duty letters / answers     years/{Y}/secretaryDuty/{workerId}/{YYYYMM}/days
// Needs secretary_duties.js (window.SecretaryDuties) and secretary_graduation.js.
(function (global) {
  'use strict';

  const D = () => global.SecretaryDuties;
  const pad = (n) => String(n).padStart(2, '0');

  function eachDay(from, to) {
    const out = [];
    for (let d = from; d <= to; d = D().shiftYmd(d, 1)) out.push(d);
    return out;
  }

  // Period → { from, to, label } (clipped to today; never before 2026 for this desk).
  function periodRange(kind, anchorYmd) {
    const a = new Date(`${anchorYmd}T12:00:00`);
    let from = anchorYmd;
    let to = anchorYmd;
    let label = D().prettyDate(anchorYmd);
    if (kind === 'week') {
      const back = (a.getDay() + 6) % 7; // Monday start
      from = D().shiftYmd(anchorYmd, -back);
      to = D().shiftYmd(from, 6);
      label = `Wiki ya ${from} hadi ${to}`;
    } else if (kind === 'month') {
      from = `${anchorYmd.slice(0, 7)}-01`;
      const last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
      to = `${anchorYmd.slice(0, 7)}-${pad(last)}`;
      label = new Intl.DateTimeFormat('sw-TZ', { month: 'long', year: 'numeric' }).format(a);
    } else if (kind === 'year') {
      from = `${anchorYmd.slice(0, 4)}-01-01`;
      to = `${anchorYmd.slice(0, 4)}-12-31`;
      label = `Mwaka ${anchorYmd.slice(0, 4)}`;
    }
    const today = D().todayYmd();
    if (to > today) to = today;
    if (from < D().DUTY_START_YMD) from = D().DUTY_START_YMD;
    return { kind, from, to, label };
  }

  function timeOf(ts) {
    if (!ts) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }).format(new Date(Number(ts)));
    } catch (_) { return ''; }
  }

  async function readVal(ref) {
    try { return (await ref.once('value')).val(); } catch (err) { console.warn('Report read failed', err?.message || err); return null; }
  }

  // Monthly attendance of one class, trying the same class-name spellings as the duty checks.
  async function classMonth(db, schoolId, cls, yyyyMm) {
    for (const name of D().classVariants(cls)) {
      const val = await readVal(db.ref(`schools/${schoolId}/attendance/${name}/${yyyyMm}`));
      if (val && typeof val === 'object' && Object.keys(val).length) return val;
    }
    return {};
  }

  async function collect(env, range) {
    const SD = D();
    const G = global.SecretaryGraduation;
    const desk = SD.deskFor(env.schoolId);
    const days = eachDay(range.from, range.to).filter((d) => SD.isMonToFri(d));
    const years = Array.from(new Set(days.map((d) => d.slice(0, 4))));
    const months = Array.from(new Set(days.map((d) => d.slice(0, 7))));

    // Worker records and duty docs per month.
    const workerByDay = {};
    const dutyByDay = {};
    await Promise.all(months.map(async (ym) => {
      const year = ym.slice(0, 4);
      const monthKey = ym.replace('-', '');
      let rec = await readVal(env.schoolRef(`years/${year}/workerAttendance/${env.workerId}/${monthKey}`));
      if (!rec && global.SomapSecretary?.isSocrates?.(env.schoolId)) rec = await readVal(env.db.ref(`attendance/${env.workerId}/${monthKey}`));
      Object.entries(rec || {}).forEach(([dayKey, v]) => { workerByDay[dayKey] = v; });
      const duty = await readVal(env.schoolRef(`years/${year}/secretaryDuty/${env.workerId}/${monthKey}/days`));
      Object.entries(duty || {}).forEach(([dayKey, v]) => { dutyByDay[dayKey] = v; });
    }));

    // Preform One students (attendance lives on each learner).
    const preformByYear = {};
    if (desk.preformOne) {
      await Promise.all(years.map(async (y) => { preformByYear[y] = await SD.readPreformStudents(env.db, y).catch(() => ({})); }));
    }

    // Graduation calls per day + the current paid / owing picture.
    const callsByDay = {};
    let graduation = null;
    if (desk.graduation && G) {
      await Promise.all(years.map(async (y) => {
        const [students, reports, lists] = await Promise.all([
          G.loadStudents(env.db, env.schoolId, y).catch(() => []),
          G.loadReports(env.db, env.schoolId, y).catch(() => ({})),
          readVal(env.db.ref(`${G.gradBase(env.schoolId, y)}/secretaryCalls/days`)),
        ]);
        const made = {};
        Object.values(reports).forEach((entries) => {
          const seen = new Set();
          (entries || []).forEach((r) => { if (r.ymd && !seen.has(r.ymd)) { seen.add(r.ymd); made[r.ymd] = (made[r.ymd] || 0) + 1; } });
        });
        const debtors = students.filter((s) => s.balance > 0);
        days.filter((d) => d.startsWith(y)).forEach((d) => {
          const list = lists?.[d]?.adms;
          const size = Array.isArray(list) ? list.length : Object.keys(list || {}).length;
          callsByDay[d] = { made: made[d] || 0, required: Math.min(G.CALLS_PER_DAY, size || debtors.length) };
        });
        if (y === years[years.length - 1]) {
          graduation = {
            students: students.length,
            paidUp: students.length - debtors.length,
            debtors: debtors.length,
            outstanding: debtors.reduce((t, s) => t + s.balance, 0),
            collected: students.reduce((t, s) => t + Math.min(s.paid, s.expected), 0),
          };
        }
      }));
    }

    // Linked schools: classes, monthly attendance and the expense queue.
    const linked = await Promise.all(desk.linkedSchools.map(async (school) => {
      const byYear = {};
      await Promise.all(years.map(async (y) => {
        const [classes, expenses] = await Promise.all([
          SD.linkedClasses(env, school.id, y).catch(() => []),
          SD.readLinkedExpenses(env.db, school.id, y).catch(() => []),
        ]);
        byYear[y] = { classes, expenses };
      }));
      const monthData = {};
      await Promise.all(months.map(async (ym) => {
        const classes = byYear[ym.slice(0, 4)]?.classes || [];
        monthData[ym] = {};
        await Promise.all(classes.map(async (cls) => { monthData[ym][cls] = await classMonth(env.db, school.id, cls, ym); }));
      }));
      return { school, byYear, monthData };
    }));

    const rows = [];
    for (const ymd of days) {
      const dayKey = SD.dayKeyOf(ymd);
      const y = ymd.slice(0, 4);
      const worker = workerByDay[dayKey] || null;
      const duty = dutyByDay[dayKey] || {};
      const row = {
        ymd,
        checkIn: timeOf(worker?.checkInTs),
        checkOut: timeOf(worker?.checkOutTs),
        worked: Boolean(worker?.checkInTs),
        override: Boolean(duty.checkoutOverride),
        feesAnswer: duty.feesCheck?.answer || '',
        debtsPdf: Boolean(duty.preformDebts?.downloadedAt),
        calls: callsByDay[ymd] || null,
        preform: desk.preformOne ? SD.preformDay(preformByYear[y], ymd) : null,
        linked: [],
      };
      for (const L of linked) {
        const classes = L.byYear[y]?.classes || [];
        let schoolDay = false;
        let done = true;
        let present = 0;
        let absent = 0;
        for (const cls of classes) {
          if (!(await SD.classIsSchoolDay(L.school.id, cls, ymd))) continue;
          schoolDay = true;
          const c = SD.countClassDay(L.monthData[ymd.slice(0, 7)]?.[cls]?.[ymd]);
          if (!c.count) done = false;
          present += c.present;
          absent += c.absent;
        }
        const exp = SD.expensesOn(L.byYear[y]?.expenses, ymd);
        row.linked.push({
          id: L.school.id, short: L.school.short, schoolDay,
          attendanceDone: !schoolDay || done, present, absent,
          expensesCount: exp.count, expensesAmount: exp.amount, expensesDone: !schoolDay || exp.count > 0,
        });
      }
      rows.push(row);
    }

    // Totals.
    const sum = (f) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);
    const preformRequired = rows.filter((r) => r.preform?.required);
    const totals = {
      days: rows.length,
      worked: rows.filter((r) => r.worked).length,
      overrides: rows.filter((r) => r.override).length,
      preform: desk.preformOne ? {
        required: preformRequired.length,
        done: preformRequired.filter((r) => r.preform.done).length,
        present: sum((r) => r.preform?.present),
        absent: sum((r) => r.preform?.absent),
      } : null,
      calls: desk.graduation ? { made: sum((r) => r.calls?.made), required: sum((r) => r.calls?.required) } : null,
      linked: desk.linkedSchools.map((s) => {
        const list = rows.map((r) => r.linked.find((l) => l.id === s.id)).filter((l) => l && l.schoolDay);
        return {
          id: s.id, short: s.short, schoolDays: list.length,
          attendanceDone: list.filter((l) => l.attendanceDone).length,
          present: list.reduce((t, l) => t + l.present, 0),
          absent: list.reduce((t, l) => t + l.absent, 0),
          expensesDays: list.filter((l) => l.expensesCount > 0).length,
          expensesAmount: list.reduce((t, l) => t + l.expensesAmount, 0),
        };
      }),
    };
    let preformDebts = null;
    if (desk.preformOne) {
      const latest = preformByYear[years[years.length - 1]] || {};
      const d = SD.preformDebtors(latest, range.to);
      preformDebts = { debtors: d.rows.length, outstanding: d.outstanding, learners: d.learners };
    }
    return { range, desk, rows, totals, graduation, preformDebts, generatedAt: Date.now() };
  }

  // Score 0–100: share of the required daily duties that were done.
  function score(report) {
    let need = 0;
    let done = 0;
    report.rows.forEach((r) => {
      if (r.preform?.required) { need += 1; if (r.preform.done) done += 1; }
      r.linked.forEach((l) => {
        if (!l.schoolDay) return;
        need += 2;
        if (l.attendanceDone) done += 1;
        if (l.expensesDone) done += 1;
      });
      if (r.calls?.required) { need += 1; if (r.calls.made >= r.calls.required) done += 1; }
    });
    return need ? Math.round((done / need) * 100) : 100;
  }

  async function downloadPdf(report, { schoolName, workerName }) {
    const SD = D();
    const { ensurePdf, pdfHeader, pdfFooter, pdfStatBoxes } = SD.pdf;
    const JsPDF = await ensurePdf();
    const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const w = doc.internal.pageSize.getWidth();
    const t = report.totals;
    let y = await pdfHeader(doc, {
      title: 'Ripoti ya Kazi za Katibu',
      subtitle: `${schoolName || ''} · ${workerName || ''} · ${report.range.label} (${report.range.from} – ${report.range.to})`,
      accent: [124, 58, 237],
    });
    const boxes = [
      { label: 'Ufanisi wa kazi', value: `${score(report)}%`, color: [109, 40, 217] },
      { label: 'Siku za kazi / alizoingia', value: `${t.days} / ${t.worked}` },
      { label: 'Aliondoka kwa barua', value: t.overrides, color: t.overrides ? [190, 18, 60] : [21, 128, 61] },
    ];
    if (t.preform) boxes.push({ label: 'Preform One: siku zilizowekwa', value: `${t.preform.done}/${t.preform.required}`, color: t.preform.done < t.preform.required ? [190, 18, 60] : [21, 128, 61] });
    if (t.calls) boxes.push({ label: 'Simu za mahafali', value: `${t.calls.made}/${t.calls.required}` });
    y = pdfStatBoxes(doc, y, boxes);
    const boxes2 = [];
    t.linked.forEach((l) => {
      boxes2.push({ label: `${l.short}: mahudhurio (siku)`, value: `${l.attendanceDone}/${l.schoolDays}`, color: l.attendanceDone < l.schoolDays ? [190, 18, 60] : [21, 128, 61] });
      boxes2.push({ label: `${l.short}: matumizi · ${SD.tsh(l.expensesAmount)}`, value: `${l.expensesDays}/${l.schoolDays}`, color: l.expensesDays < l.schoolDays ? [190, 18, 60] : [21, 128, 61] });
    });
    if (report.graduation) boxes2.push({ label: 'Mahafali: wamelipa / wanadaiwa', value: `${report.graduation.paidUp} / ${report.graduation.debtors}` });
    if (report.preformDebts) boxes2.push({ label: `Preform One wenye deni · ${SD.tsh(report.preformDebts.outstanding)}`, value: report.preformDebts.debtors, color: [190, 18, 60] });
    if (boxes2.length) y = pdfStatBoxes(doc, y, boxes2.slice(0, 6));

    const linkedHead = report.desk.linkedSchools.flatMap((s) => [`${s.short} mahud.`, `${s.short} matumizi`]);
    const head = ['Tarehe', 'Ndani', 'Nje', ...(report.desk.preformOne ? ['Preform One (P/A)'] : []), ...linkedHead, ...(report.desk.graduation ? ['Simu'] : []), 'Ada (jibu)', 'Barua'];
    const body = report.rows.map((r) => {
      const linkedCells = r.linked.flatMap((l) => (l.schoolDay
        ? [l.attendanceDone ? `OK ${l.present}/${l.absent}` : 'X Haikuwekwa', l.expensesCount ? `OK ${l.expensesCount} · ${SD.tsh(l.expensesAmount)}` : 'X Hakuna']
        : ['-', '-']));
      const fees = { none: 'Hakuna', entered: 'Ameingiza', pending: 'Bado' }[r.feesAnswer] || '';
      return [
        `${r.ymd} ${new Intl.DateTimeFormat('sw-TZ', { weekday: 'short' }).format(new Date(`${r.ymd}T12:00:00`))}`,
        r.checkIn || '-', r.checkOut || '-',
        ...(report.desk.preformOne ? [r.preform?.required ? (r.preform.done ? `OK ${r.preform.present}/${r.preform.absent}` : 'X Haikuwekwa') : '-'] : []),
        ...linkedCells,
        ...(report.desk.graduation ? [r.calls ? `${r.calls.made}/${r.calls.required}` : '-'] : []),
        fees || '-',
        r.override ? 'Ndiyo' : '',
      ];
    });
    doc.autoTable({
      startY: y,
      head: [head],
      body,
      styles: { fontSize: 7.6, cellPadding: 1.8 },
      headStyles: { fillColor: [15, 22, 48], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const v = String(data.cell.raw || '');
        if (v.startsWith('X ') || v === 'Ndiyo' || v === 'Bado') data.cell.styles.textColor = [190, 18, 60];
        else if (v.startsWith('OK')) data.cell.styles.textColor = [21, 128, 61];
      },
      margin: { left: 10, right: 10 },
    });
    let end = doc.lastAutoTable.finalY + 8;
    if (end > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); end = 20; }
    doc.setFontSize(8.5);
    doc.setTextColor(90, 100, 120);
    doc.text('P/A = waliopo / wasiokuwepo. "Barua" = aliondoka bila kumaliza kazi na kuandika maelezo. Matumizi yote yanasubiri idhini kabla ya kuhesabiwa.', 10, end);
    doc.setTextColor(30, 30, 30);
    doc.text('Sahihi ya Katibu: ______________________', 10, end + 12);
    doc.text('Sahihi ya Mkuu wa Shule: ______________________', w / 2, end + 12);
    pdfFooter(doc);
    doc.save(`Ripoti_Katibu_${report.range.kind}_${report.range.from}_${report.range.to}.pdf`);
  }

  global.SecretaryReport = { periodRange, collect, score, downloadPdf };
})(window);
