const { useState, useEffect, useMemo } = React;

const L = (v) => String(v || '').trim().toLowerCase();
const currency = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0 });
const ALLOWED_STATUSES = ['payment_pending_approval', 'paid_form_issued', 'awaiting_admission', 'admitted', 'rejected', 'no_show'];

function resolveYearOptions() {
  const base = Number(new Date().getFullYear());
  const years = [];
  for (let y = base - 1; y <= base + 6; y += 1) years.push(String(y));
  const ctx = window.somapYearContext;
  const anchor = ctx?.getSelectedYear?.();
  if (anchor && !years.includes(String(anchor))) years.push(String(anchor));
  return Array.from(new Set(years)).sort();
}

function initYearSelect(selectedYear, onChange) {
  const select = document.getElementById('yearSelect');
  if (!select) return;
  select.innerHTML = '';
  resolveYearOptions().forEach((y) => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  });
  select.value = selectedYear;
  select.addEventListener('change', (e) => onChange(String(e.target.value)));
}

function useSchoolId() {
  const [schoolId, setSchoolId] = useState(() => (window.JoiningService?.resolveSchoolId?.() || 'socrates'));
  useEffect(() => {
    const label = document.getElementById('schoolLabel');
    if (label) label.textContent = schoolId;
  }, [schoolId]);
  return schoolId;
}

function formatCurrency(amount) {
  const v = Number(amount || 0);
  return `TSh ${currency.format(v)}`;
}

function statusPill(status) {
  const map = {
    payment_pending_approval: { label: 'Pending payment approval', tone: 'bg-amber-500/15 text-amber-200 border border-amber-500/30' },
    paid_form_issued: { label: 'Paid form issued', tone: 'bg-sky-500/15 text-sky-100 border border-sky-400/30' },
    awaiting_admission: { label: 'Awaiting admission', tone: 'bg-indigo-500/15 text-indigo-100 border border-indigo-400/30' },
    admitted: { label: 'Admitted', tone: 'bg-emerald-500/18 text-emerald-100 border border-emerald-400/30' },
    rejected: { label: 'Rejected', tone: 'bg-rose-500/18 text-rose-100 border border-rose-400/30' },
    no_show: { label: 'No show', tone: 'bg-slate-500/18 text-slate-100 border border-slate-400/30' },
  };
  return map[status] || { label: status || 'Unknown', tone: 'bg-slate-600/30 text-slate-200 border border-slate-500/40' };
}

function NewApplicationsDashboard() {
  const schoolId = useSchoolId();
  const defaultYear = (window.somapYearContext?.getSelectedYear?.() || String(new Date().getFullYear()));
  const [year, setYear] = useState(String(defaultYear));
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const db = window.db || (window.firebase && window.firebase.database ? window.firebase.database() : null);

  // Sync dropdown + year context
  useEffect(() => {
    initYearSelect(year, (nextYear) => {
      setYear(nextYear);
      window.somapYearContext?.setSelectedYear?.(nextYear, { manual: true });
    });
    const listener = (e) => setYear(String(e.detail || window.somapYearContext?.getSelectedYear?.() || year));
    window.addEventListener('somapYearChanged', listener);
    return () => window.removeEventListener('somapYearChanged', listener);
  }, []);

  // Listen to applications
  useEffect(() => {
    if (!db || !window.JoiningService) {
      setError('Database not available');
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const stop = window.JoiningService.listenJoiningApplications(year, (list) => {
      setApps(list);
      setLoading(false);
    });
    return stop;
  }, [year, schoolId]);

  const filtered = useMemo(() => {
    return apps.filter((a) => {
      if (a.paymentVerificationStatus !== 'verified') return false;
      if (['rejected', 'no_show'].includes(a.status)) return false;
      return true;
    });
  }, [apps]);

  const metrics = useMemo(() => {
    const verified = apps.filter((a) => a.paymentVerificationStatus === 'verified');
    const awaiting = verified.filter((a) => ['paid_form_issued', 'awaiting_admission'].includes(a.status));
    const admitted = verified.filter((a) => a.status === 'admitted');
    const totalFees = verified.reduce((sum, a) => sum + Number(a.joiningFeeAmount || 0), 0);
    return {
      total: apps.length,
      verified: verified.length,
      awaiting: awaiting.length,
      admitted: admitted.length,
      totalFees,
    };
  }, [apps]);

  async function confirmPayment(app) {
    if (!window.JoiningService) return;
    try {
      await window.JoiningService.updateJoiningApplication(year, app.id, {
        paymentVerificationStatus: 'verified',
        status: app.status === 'payment_pending_approval' ? 'paid_form_issued' : app.status,
        paymentVerifiedAt: Date.now(),
        paymentVerifiedByUserId: 'system',
      });
    } catch (err) {
      console.error(err);
      alert('Failed to confirm payment: ' + (err.message || err));
    }
  }

  async function markNoShow(app) {
    if (!window.JoiningService) return;
    const ok = confirm(`Mark ${app.childFirstName || 'applicant'} as no show?`);
    if (!ok) return;
    try {
      await window.JoiningService.updateJoiningApplication(year, app.id, { status: 'no_show' });
    } catch (err) {
      console.error(err);
      alert('Failed to mark no show: ' + (err.message || err));
    }
  }

  async function importToAdmission(app) {
    if (!db) return;
    const studentId = `AUTO-${Date.now()}`;
    const path = window.JoiningService.withSchoolPath(`students/${year}/${studentId}`);
    const record = {
      admissionNumber: studentId,
      firstName: app.childFirstName || '',
      middleName: app.childMiddleName || '',
      lastName: app.childLastName || '',
      gender: app.gender || '',
      dob: app.dateOfBirth || '',
      classLevel: app.classLevel || '',
      primaryParentName: app.parentFullName || '',
      primaryParentContact: app.parentPhone || '',
      parentEmail: app.parentEmail || '',
      residentialAddress: app.residentialAddress || '',
      academicYear: year,
      source: app.source || 'ONLINE',
      joinedFrom: 'joiningApplications',
      createdAt: Date.now(),
    };
    try {
      await db.ref(path).set(record);
      await window.JoiningService.updateJoiningApplication(year, app.id, { status: 'admitted', studentId });
      alert('Imported to admission.');
    } catch (err) {
      console.error(err);
      alert('Failed to import: ' + (err.message || err));
    }
  }

  const pending = apps.filter((a) => a.paymentVerificationStatus !== 'verified' && !['rejected', 'no_show'].includes(a.status));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total applications" value={metrics.total} hint={`All sources, ${year}`} />
        <MetricCard label="Verified (paid)" value={metrics.verified} hint="paymentVerificationStatus = verified" />
        <MetricCard label="Awaiting admission" value={metrics.awaiting} hint="Paid, not yet admitted" />
        <MetricCard label="Joining fees collected" value={formatCurrency(metrics.totalFees)} hint="Verified payments only" />
      </div>

      {error && <div className="glass border border-rose-500/40 text-rose-100 p-4 rounded-xl">{error}</div>}

      <Section title="New Applicants" subtitle="Verified, ready for admission" count={filtered.length}>
        {loading ? (
          <div className="text-slate-300 text-sm">Loading applications…</div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-400 text-sm">No verified applications for {year} yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <Th>Child</Th>
                  <Th>Class</Th>
                  <Th>Parent</Th>
                  <Th>Phone</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th>Joining Fee</Th>
                  <Th>Downloads</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((app) => {
                  const pill = statusPill(app.status);
                  return (
                    <tr key={app.id} className="border-b border-slate-800/80 hover:bg-slate-800/40 transition">
                      <Td>
                        <div className="font-semibold text-slate-100">{[app.childFirstName, app.childMiddleName, app.childLastName].filter(Boolean).join(' ')}</div>
                        <div className="text-xs text-slate-400">{app.gender} • {app.dateOfBirth}</div>
                      </Td>
                      <Td>{app.classLevel || '—'}</Td>
                      <Td>{app.parentFullName || '—'}</Td>
                      <Td className="font-mono text-xs">{app.parentPhone || '—'}</Td>
                      <Td><span className="uppercase text-xs tracking-wide text-slate-300">{app.source || 'ONLINE'}</span></Td>
                      <Td>
                        <span className={`pill ${pill.tone}`}>{pill.label}</span>
                        <div className="text-[11px] text-slate-400 mt-1 capitalize">Payment: {app.paymentVerificationStatus || 'pending'}</div>
                      </Td>
                      <Td>{formatCurrency(app.joiningFeeAmount || 0)}</Td>
                      <Td>{app.downloadCount || 0}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          <button className="px-3 py-1 rounded-lg bg-sky-500/20 text-sky-100 text-xs border border-sky-400/40 hover:bg-sky-500/30" onClick={() => importToAdmission(app)}>Import</button>
                          <button className="px-3 py-1 rounded-lg bg-slate-700/40 text-slate-200 text-xs border border-slate-500/40 hover:bg-slate-600/60" onClick={() => markNoShow(app)}>No show</button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Leads / Pending" subtitle="Awaiting payment verification" count={pending.length}>
        {pending.length === 0 ? (
          <div className="text-slate-400 text-sm">No pending payments.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <Th>Child</Th>
                  <Th>Class</Th>
                  <Th>Parent</Th>
                  <Th>Phone</Th>
                  <Th>Source</Th>
                  <Th>Payment Ref</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((app) => (
                  <tr key={app.id} className="border-b border-slate-800/80 hover:bg-slate-800/40 transition">
                    <Td>
                      <div className="font-semibold text-slate-100">{[app.childFirstName, app.childMiddleName, app.childLastName].filter(Boolean).join(' ')}</div>
                      <div className="text-xs text-slate-400">{app.classLevel || '—'}</div>
                    </Td>
                    <Td>{app.classLevel || '—'}</Td>
                    <Td>{app.parentFullName || '—'}</Td>
                    <Td className="font-mono text-xs">{app.parentPhone || '—'}</Td>
                    <Td><span className="uppercase text-xs tracking-wide text-slate-300">{app.source || 'ONLINE'}</span></Td>
                    <Td className="font-mono text-xs">{app.paymentReference || '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <button className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-100 text-xs border border-emerald-400/40 hover:bg-emerald-500/30" onClick={() => confirmPayment(app)}>Confirm payment</button>
                        <button className="px-3 py-1 rounded-lg bg-slate-700/40 text-slate-200 text-xs border border-slate-500/40 hover:bg-slate-600/60" onClick={() => markNoShow(app)}>Reject / No show</button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="glass p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{hint}</p>
    </div>
  );
}

function Section({ title, subtitle, count, children }) {
  return (
    <div className="glass p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-300">{subtitle}</p>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Count</p>
          <p className="text-lg font-semibold text-slate-100">{count}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left text-[11px] uppercase tracking-[0.14em] text-slate-300 px-3 py-2 border-b border-slate-800/70">{children}</th>;
}
function Td({ children }) {
  return <td className="px-3 py-3 align-top text-slate-100/90 text-sm">{children}</td>;
}

ReactDOM.createRoot(document.getElementById('newApplicationsRoot')).render(<NewApplicationsDashboard />);
