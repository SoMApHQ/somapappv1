(async function dashboardSchoolCalendar() {
  'use strict';

  const Calendar = window.SomapSchoolCalendar;
  if (!Calendar || !window.firebase) return;

  const school = window.SOMAP?.getSchool?.() || window.SOMAP?.getActiveSchool?.() || {};
  const schoolId = school.id || window.currentSchoolId || 'socrates-school';
  const selectedYear = () => String(window.somapYearContext?.getSelectedYear?.() || localStorage.getItem('somapSelectedYear') || new Date().getFullYear());
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const todayIso = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const typeMeta = (entry) => Calendar.TYPE_META[entry.type] || Calendar.TYPE_META.school_event;
  const calendarUrl = (year) => `workershtml/Toworkertaskshtml/school_calendar.html?school=${encodeURIComponent(schoolId)}&year=${encodeURIComponent(year)}`;
  const state = { entries: [], meta: null, year: selectedYear() };

  function friendlyDate(entry, options) {
    const start = new Date(`${entry.startDate}T12:00:00`);
    const endDate = entry.endDate || entry.startDate;
    const end = new Date(`${endDate}T12:00:00`);
    if (entry.startDate === endDate) return start.toLocaleDateString(undefined, options || { weekday: 'short', day: 'numeric', month: 'short' });
    return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  function eventListItem(entry) {
    const date = new Date(`${entry.startDate}T12:00:00`);
    const meta = typeMeta(entry);
    return `<li class="dashboard-calendar-event dashboard-calendar-link" style="--event-color:${meta.color}" tabindex="0" role="link"><span class="dashboard-event-date"><b>${date.getDate()}</b><span>${escapeHtml(date.toLocaleDateString(undefined, { month: 'short' }))}</span></span><span class="dashboard-event-copy"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(friendlyDate(entry))}</small><small class="dashboard-event-type">${escapeHtml(meta.label)}</small></span></li>`;
  }

  function ensureModal() {
    if (document.getElementById('dashboardEventsModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="dashboard-events-modal hidden" id="dashboardEventsModal" role="dialog" aria-modal="true" aria-labelledby="dashboardEventsTitle"><div class="dashboard-events-dialog"><div class="dashboard-events-head"><div><small>SHARED SCHOOL CALENDAR</small><h2 id="dashboardEventsTitle">Events &amp; Important Dates</h2><p id="dashboardEventsIntro"></p></div><button type="button" id="dashboardEventsClose" aria-label="Close calendar">×</button></div><div class="dashboard-events-legend" id="dashboardEventsLegend"></div><div id="dashboardEventsAnnual"></div><div class="dashboard-events-actions"><button class="btn quick-action-btn" id="dashboardEventsPdf" type="button">Download PDF</button><button class="btn quick-action-btn" id="dashboardEventsManage" type="button">Manage Calendar</button><button class="btn quick-action-btn" id="dashboardEventsCloseBottom" type="button">Close</button></div></div></div>`);
    const modal = document.getElementById('dashboardEventsModal');
    const close = () => { modal.classList.add('hidden'); document.body.classList.remove('dashboard-events-open'); };
    document.getElementById('dashboardEventsClose').onclick = close;
    document.getElementById('dashboardEventsCloseBottom').onclick = close;
    document.getElementById('dashboardEventsManage').onclick = () => { window.location.href = calendarUrl(state.year); };
    document.getElementById('dashboardEventsPdf').onclick = downloadEventsPdf;
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
  }

  function renderModal() {
    ensureModal();
    const intro = document.getElementById('dashboardEventsIntro');
    const legend = document.getElementById('dashboardEventsLegend');
    const annual = document.getElementById('dashboardEventsAnnual');
    intro.textContent = `${state.entries.length} published dates from January–December ${state.year}`;
    const usedTypes = [...new Map(state.entries.map((entry) => [entry.type, typeMeta(entry)])).values()];
    legend.innerHTML = usedTypes.map((meta) => `<span><i style="background:${meta.color}"></i>${escapeHtml(meta.label)}</span>`).join('');
    const months = Array.from({ length: 12 }, (_, month) => new Date(Number(state.year), month, 1).toLocaleDateString(undefined, { month: 'long' }));
    annual.innerHTML = months.map((name, month) => {
      const items = state.entries.filter((entry) => Number(entry.startDate.slice(5, 7)) - 1 === month);
      if (!items.length) return '';
      return `<section class="dashboard-events-month"><h3>${escapeHtml(name)}</h3>${items.map(eventListItem).join('')}</section>`;
    }).join('') || '<p class="dashboard-calendar-empty">No school events have been published.</p>';
  }

  function openEventsModal() {
    renderModal();
    const modal = document.getElementById('dashboardEventsModal');
    modal.classList.remove('hidden');
    document.body.classList.add('dashboard-events-open');
    document.getElementById('dashboardEventsClose').focus();
  }

  async function downloadEventsPdf() {
    if (!window.jspdf?.jsPDF || !state.entries.length) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, 595, 100, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(20); doc.text(`${state.meta.schoolName} Events`, 36, 42);
    doc.setFontSize(10); doc.text(`Shared calendar | January – December ${state.year}`, 36, 64);
    const months = Array.from({ length: 12 }, (_, month) => new Date(Number(state.year), month, 1).toLocaleDateString(undefined, { month: 'long' }));
    const rows = [];
    months.forEach((name, month) => {
      const items = state.entries.filter((entry) => Number(entry.startDate.slice(5, 7)) - 1 === month);
      if (!items.length) rows.push([name, '—', 'No published events', '—']);
      else items.forEach((entry, index) => rows.push([index ? '' : name, friendlyDate(entry), entry.title, typeMeta(entry).label]));
    });
    doc.autoTable({ startY: 118, head: [['Month', 'Date', 'Event', 'Category']], body: rows, theme: 'grid', styles: { fontSize: 8, cellPadding: 5 }, headStyles: { fillColor: [37, 99, 235] }, alternateRowStyles: { fillColor: [241, 245, 249] } });
    doc.save(`${state.meta.schoolName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-events-${state.year}.pdf`);
  }

  function renderMonth(entries, year) {
    const host = document.getElementById('calendar-view');
    const heading = host?.previousElementSibling;
    if (!host) return;
    const now = new Date();
    const upcoming = entries.find((entry) => (entry.endDate || entry.startDate) >= todayIso());
    const focusDate = upcoming ? new Date(`${upcoming.startDate}T12:00:00`) : new Date(Number(year), now.getMonth(), 1);
    const month = focusDate.getMonth();
    if (heading) heading.textContent = focusDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const first = new Date(Number(year), month, 1);
    const lastDay = new Date(Number(year), month + 1, 0).getDate();
    const cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<span class="dashboard-calendar-weekday">${day}</span>`);
    for (let blank = 0; blank < first.getDay(); blank += 1) cells.push('<span></span>');
    for (let day = 1; day <= lastDay; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const event = entries.find((item) => iso >= item.startDate && iso <= (item.endDate || item.startDate));
      const classes = ['dashboard-calendar-day'];
      if (event) classes.push('has-event');
      if (iso === todayIso()) classes.push('today');
      cells.push(`<span class="${classes.join(' ')}"${event ? ` style="--day-color:${typeMeta(event).color}" title="${escapeHtml(event.title)}"` : ''}>${day}</span>`);
    }
    host.innerHTML = `<span class="dashboard-calendar-month">${cells.join('')}</span>`;
  }

  function bindCalendarLinks(year) {
    const url = calendarUrl(year);
    document.querySelectorAll('.dashboard-calendar-link').forEach((element) => {
      element.onclick = openEventsModal;
      element.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEventsModal(); } };
    });
    const upcomingSection = document.querySelector('section#upcoming-events');
    const viewButton = upcomingSection?.querySelector('.quick-action-btn');
    if (viewButton) {
      viewButton.onclick = openEventsModal;
    }
    const eventsSection = document.querySelector('section#events');
    const createButton = eventsSection?.querySelector('.quick-action-btn');
    if (createButton) {
      createButton.textContent = 'Open School Calendar';
      createButton.onclick = () => { window.location.href = url; };
    }
    eventsSection?.querySelector('.calendar')?.classList.add('dashboard-calendar-link');
    const upcomingCard = document.getElementById('upcoming-event-details')?.closest('.card');
    upcomingCard?.classList.add('dashboard-calendar-link');
    if (eventsSection?.querySelector('.calendar')) eventsSection.querySelector('.calendar').onclick = openEventsModal;
    if (upcomingCard) upcomingCard.onclick = openEventsModal;
    const commandEvents = document.querySelector('[data-module="events"]');
    if (commandEvents) commandEvents.onclick = openEventsModal;
  }

  async function load() {
    const year = selectedYear();
    const summary = document.querySelector('p#upcoming-events');
    const list = document.getElementById('events-list');
    const details = document.getElementById('upcoming-event-details');
    try {
      const [meta, saved] = await Promise.all([
        Calendar.getSchoolCalendarMeta(year, { schoolId, schoolName: school.name }),
        Calendar.listSchoolCalendarEntries(year, { schoolId, forceRefresh: true }),
      ]);
      const holidays = Calendar.getCountryPublicHolidayEntries(year, { country: meta.country });
      const entries = saved.filter((entry) => entry.active !== false).concat(holidays)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
      state.entries = entries;
      state.meta = meta;
      state.year = year;
      const upcoming = entries.filter((entry) => (entry.endDate || entry.startDate) >= todayIso());
      const next = upcoming[0];

      if (summary) summary.innerHTML = `<span class="dashboard-event-summary"><strong>${upcoming.length}</strong><small>${next ? `Next: ${escapeHtml(next.title)} · ${escapeHtml(friendlyDate(next))}` : `No more dates in ${escapeHtml(year)}`}</small></span>`;
      if (list) list.innerHTML = upcoming.length ? upcoming.slice(0, 6).map(eventListItem).join('') : '<li class="dashboard-calendar-empty">No upcoming school events.</li>';
      if (details) details.innerHTML = next ? `<span class="dashboard-next-event" style="--event-color:${typeMeta(next).color}"><small class="dashboard-event-type">${escapeHtml(typeMeta(next).label)}</small><strong>${escapeHtml(next.title)}</strong><span>${escapeHtml(friendlyDate(next, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span><small>${escapeHtml(next.description || next.reason || 'Published by the school calendar.')}</small></span>` : `<span class="dashboard-calendar-empty">No upcoming event has been published for ${escapeHtml(year)}.</span>`;
      renderMonth(entries, year);
      bindCalendarLinks(year);
    } catch (error) {
      console.error('Dashboard school calendar failed to load', error);
      if (summary) summary.innerHTML = '<span class="dashboard-calendar-empty">Calendar unavailable</span>';
      if (list) list.innerHTML = '<li class="dashboard-calendar-empty">Unable to load school events.</li>';
      if (details) details.textContent = 'Unable to load the school calendar.';
    }
  }

  await load();
  if (window.somapYearContext?.onYearChanged) window.somapYearContext.onYearChanged(load);
})();
