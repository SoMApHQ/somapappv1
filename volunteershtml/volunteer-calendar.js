(async function volunteerCalendar() {
  'use strict';

  const Calendar = window.SomapSchoolCalendar;
  const Volunteers = window.SomapVolunteers;
  const list = document.getElementById('events');
  if (!Calendar || !Volunteers || !list) return;

  const session = Volunteers.getSession();
  if (!session) return;
  const year = String(session.year || new Date().getFullYear());
  const schoolId = session.schoolId || 'socrates-school';
  const escape = Volunteers.escapeHtml;
  const card = list.closest('.portal-card');
  card.classList.add('events-card');
  card.innerHTML = `<div class="events-heading"><div><div class="eyebrow">Shared school calendar</div><h2>Events &amp; Important Dates</h2><p class="muted" id="eventsIntro">Loading published events…</p></div><div class="events-actions"><button class="btn secondary" id="eventsViewToggle" type="button" aria-pressed="false">View full year</button><button class="btn" id="downloadEventsPdf" type="button" disabled>Download PDF</button></div></div><div class="event-legend" id="eventLegend" aria-label="Event colour legend"></div><div id="events" class="events-list" aria-live="polite"><div class="events-empty">Preparing the shared calendar…</div></div>`;

  const eventsList = document.getElementById('events');
  const intro = document.getElementById('eventsIntro');
  const toggle = document.getElementById('eventsViewToggle');
  const pdfButton = document.getElementById('downloadEventsPdf');
  const legend = document.getElementById('eventLegend');
  const monthNames = Array.from({ length: 12 }, (_, month) => new Date(Number(year), month, 1).toLocaleDateString(undefined, { month: 'long' }));
  let entries = [];
  let meta = null;
  let fullYear = false;

  const todayIso = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  const typeMeta = (entry) => Calendar.TYPE_META[entry.type] || Calendar.TYPE_META.school_event;

  function isVolunteerVisible(entry) {
    if (entry.active === false || entry.parentVisible !== true) return false;
    const scope = entry.scope || {};
    const workerTargeted = scope.workersOnly || (scope.workerRoles || []).length || (scope.workerIds || []).length;
    const studentTargeted = scope.wholeSchool || scope.studentsOnly || (scope.classNames || []).length;
    return !workerTargeted || studentTargeted;
  }

  function readableRange(entry) {
    const start = new Date(`${entry.startDate}T12:00:00`);
    const end = new Date(`${entry.endDate || entry.startDate}T12:00:00`);
    if (entry.startDate === (entry.endDate || entry.startDate)) {
      return start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  function renderLegend() {
    const used = [...new Map(entries.map((entry) => [entry.type, typeMeta(entry)])).values()];
    legend.innerHTML = used.map((item) => `<span><i style="background:${item.color}"></i>${escape(item.label)}</span>`).join('');
  }

  function eventCard(entry) {
    const start = new Date(`${entry.startDate}T12:00:00`);
    const details = entry.description || entry.reason || '';
    const type = typeMeta(entry);
    return `<article class="volunteer-event" style="--event-color:${type.color}"><div class="event-date-tile"><strong>${start.getDate()}</strong><span>${escape(start.toLocaleDateString(undefined, { month: 'short' }))}</span></div><div class="event-copy"><h3>${escape(entry.title)}</h3><div class="event-meta"><span class="event-type">${escape(type.label)}</span><span>${escape(readableRange(entry))}</span></div>${details ? `<p class="event-description">${escape(details)}</p>` : ''}</div></article>`;
  }

  function render() {
    const visible = fullYear ? entries : entries.filter((entry) => (entry.endDate || entry.startDate) >= todayIso).slice(0, 6);
    intro.textContent = fullYear ? `${entries.length} published date${entries.length === 1 ? '' : 's'} across January–December ${year}` : `What is coming up at ${meta.schoolName} in ${year}`;
    toggle.textContent = fullYear ? 'Show upcoming' : 'View full year';
    toggle.setAttribute('aria-pressed', String(fullYear));
    if (!visible.length) {
      eventsList.innerHTML = `<div class="events-empty"><strong>${fullYear ? 'No published dates for this year' : 'No more upcoming dates'}</strong>${fullYear ? 'The school will publish shared events here.' : `Choose “View full year” to see earlier events from ${escape(year)}.`}</div>`;
      return;
    }
    const grouped = new Map();
    visible.forEach((entry) => {
      const month = Number(entry.startDate.slice(5, 7)) - 1;
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month).push(entry);
    });
    eventsList.innerHTML = [...grouped.entries()].map(([month, items]) => `<section class="event-month"><h3 class="event-month-title">${escape(monthNames[month])}</h3>${items.map(eventCard).join('')}</section>`).join('');
  }

  async function imageData(url) {
    if (!url) return '';
    try {
      const response = await fetch(url);
      if (!response.ok) return '';
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (_) { return ''; }
  }

  async function downloadPdf() {
    if (!window.jspdf?.jsPDF || !entries.length || typeof window.jspdf.jsPDF.API.autoTable !== 'function') return;
    pdfButton.disabled = true;
    pdfButton.textContent = 'Preparing…';
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const logo = await imageData(meta.logoUrl || '../images/somap-logo.png');
      doc.setFillColor(14, 78, 57);
      doc.rect(0, 0, 595, 112, 'F');
      if (logo) {
        try { doc.addImage(logo, 505, 23, 58, 58); } catch (_) { /* PDF remains valid without the image. */ }
      }
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(21);
      doc.text(`${meta.schoolName} Events`, 36, 43);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`Published calendar | January – December ${year}`, 36, 65);
      doc.text(`${meta.country || ''}  •  Prepared for volunteers`, 36, 83);

      let y = 132;
      monthNames.forEach((monthName, month) => {
        const rows = entries.filter((entry) => Number(entry.startDate.slice(5, 7)) - 1 === month);
        doc.autoTable({
          startY: y,
          margin: { left: 36, right: 36 },
          head: [[`${monthName} ${year}`, 'Event / important date', 'Category']],
          body: rows.length ? rows.map((entry) => [readableRange(entry), entry.title + ((entry.description || entry.reason) ? `\n${entry.description || entry.reason}` : ''), typeMeta(entry).label]) : [['—', 'No published events', '—']],
          theme: 'plain',
          styles: { fontSize: 8.5, cellPadding: 6, textColor: [35, 52, 43], lineColor: [220, 229, 222], lineWidth: { bottom: 0.5 } },
          headStyles: { fillColor: month % 2 ? [22, 107, 77] : [33, 128, 94], textColor: 255, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 116 }, 2: { cellWidth: 88 } },
          didDrawPage() {
            const page = doc.internal.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(110, 125, 116);
            doc.text(`${meta.schoolName} • ${year} published events`, 36, 822);
            doc.text(`Page ${page}`, 535, 822, { align: 'right' });
          },
        });
        y = doc.lastAutoTable.finalY + 12;
        if (y > 750 && month < 11) { doc.addPage(); y = 36; }
      });
      doc.save(`${meta.schoolName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-events-${year}.pdf`);
    } finally {
      pdfButton.disabled = false;
      pdfButton.textContent = 'Download PDF';
    }
  }

  toggle.addEventListener('click', () => { fullYear = !fullYear; render(); });
  pdfButton.addEventListener('click', downloadPdf);

  try {
    const [calendarMeta, saved] = await Promise.all([
      Calendar.getSchoolCalendarMeta(year, { schoolId, schoolName: session.schoolName }),
      Calendar.listSchoolCalendarEntries(year, { schoolId, forceRefresh: true }),
    ]);
    meta = calendarMeta;
    const holidays = Calendar.getCountryPublicHolidayEntries(year, { country: meta.country });
    entries = saved.filter(isVolunteerVisible).concat(holidays.filter(isVolunteerVisible))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
    renderLegend();
    render();
    pdfButton.disabled = !entries.length;
  } catch (error) {
    console.error('Volunteer calendar failed to load', error);
    intro.textContent = 'The shared calendar is temporarily unavailable.';
    eventsList.innerHTML = '<div class="events-empty events-error"><strong>Calendar unavailable</strong>Please try again later.</div>';
  }
})();
