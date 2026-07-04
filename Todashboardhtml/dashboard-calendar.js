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
      const open = () => { window.location.href = url; };
      element.addEventListener('click', open);
      element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
    const upcomingSection = document.querySelector('section#upcoming-events');
    const viewButton = upcomingSection?.querySelector('.quick-action-btn');
    if (viewButton) {
      viewButton.onclick = () => { window.location.href = url; };
    }
    const eventsSection = document.querySelector('section#events');
    const createButton = eventsSection?.querySelector('.quick-action-btn');
    if (createButton) {
      createButton.textContent = 'Open School Calendar';
      createButton.onclick = () => { window.location.href = url; };
    }
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
