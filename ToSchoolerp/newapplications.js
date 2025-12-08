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
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    childFirstName: '',
    childMiddleName: '',
    childLastName: '',
    gender: '',
    dateOfBirth: '',
    classLevel: '',
    parentFullName: '',
    parentPhone: '',
    parentEmail: '',
    residentialAddress: '',
    source: 'ONSITE',
    paymentChannel: 'mpesaLipa',
    paymentReference: '',
    paymentReceiverName: '',
  });
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
    // Load settings for fee and template defaults
    window.JoiningService.getJoiningSettings(year)
      .then((cfg) => setSettings(cfg || null))
      .catch((err) => {
        console.warn('Joining settings load failed', err);
        setSettings(null);
      });
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

  async function createApplication() {
    if (!window.JoiningService) return;
    const required = ['childFirstName', 'childLastName', 'classLevel', 'parentFullName', 'parentPhone', 'paymentReference'];
    const missing = required.filter((k) => !String(formData[k] || '').trim());
    if (missing.length) {
      alert('Fill all required fields: ' + missing.join(', '));
      return;
    }
    try {
      const feeAmount = settings?.joiningFeeAmount || 0;
      const feeCurrency = settings?.joiningFeeCurrency || 'TZS';
      const templateUrl = settings?.joiningFormTemplateUrl || '';
      await window.JoiningService.createJoiningApplication(year, {
        ...formData,
        joiningFeeAmount: feeAmount,
        joiningFeeCurrency: feeCurrency,
        joiningFormTemplateUrl: templateUrl,
        paymentRecordedAt: Date.now(),
        paymentReceiverUserId: 'system',
        createdByUserId: 'system',
        source: formData.source || 'ONSITE',
        paymentVerificationStatus: 'pending',
        status: 'payment_pending_approval',
      });
      setFormOpen(false);
      setFormData({
        childFirstName: '',
        childMiddleName: '',
        childLastName: '',
        gender: '',
        dateOfBirth: '',
        classLevel: '',
        parentFullName: '',
        parentPhone: '',
        parentEmail: '',
        residentialAddress: '',
        source: 'ONSITE',
        paymentChannel: 'mpesaLipa',
        paymentReference: '',
        paymentReceiverName: '',
      });
      alert('Application recorded. Awaiting payment verification.');
    } catch (err) {
      console.error(err);
      alert('Failed to create application: ' + (err.message || err));
    }
  }

  function updateForm(key, value) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="glass px-4 py-3 border border-slate-700/60 rounded-xl">
          <p className="text-xs text-slate-400">Joining fee ({year})</p>
          <p className="text-lg font-semibold text-white">{settings ? formatCurrency(settings.joiningFeeAmount || 0) : '—'}</p>
          <p className="text-[11px] text-slate-500">Mpesa Lipa Namba: {settings?.mpesaLipaNumber || '13768688'}</p>
        </div>
        <button
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-slate-900 font-semibold shadow-lg hover:shadow-sky-500/30"
          onClick={() => setFormOpen(true)}
        >
          Record new application
        </button>
      </div>

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

      {formOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-3">
          <div className="glass w-full max-w-3xl p-5 relative">
            <button className="absolute top-3 right-3 text-slate-400 hover:text-white" onClick={() => setFormOpen(false)}>
              <i className="fas fa-times"></i>
            </button>
            <h3 className="text-xl font-semibold text-white mb-1">Record joining application</h3>
            <p className="text-sm text-slate-400 mb-4">Onsite / recommendation / online intake with payment reference.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="First name" required value={formData.childFirstName} onChange={(v) => updateForm('childFirstName', v)} />
              <Input label="Middle name" value={formData.childMiddleName} onChange={(v) => updateForm('childMiddleName', v)} />
              <Input label="Last name" required value={formData.childLastName} onChange={(v) => updateForm('childLastName', v)} />
              <Input label="Gender" value={formData.gender} onChange={(v) => updateForm('gender', v)} />
              <Input label="Date of birth" type="date" value={formData.dateOfBirth} onChange={(v) => updateForm('dateOfBirth', v)} />
              <Input label="Class level" required value={formData.classLevel} onChange={(v) => updateForm('classLevel', v)} placeholder="e.g., Class 1" />
              <Input label="Parent full name" required value={formData.parentFullName} onChange={(v) => updateForm('parentFullName', v)} />
              <Input label="Parent phone" required value={formData.parentPhone} onChange={(v) => updateForm('parentPhone', v)} placeholder="+2557..." />
              <Input label="Parent email" value={formData.parentEmail} onChange={(v) => updateForm('parentEmail', v)} />
              <Input label="Residential address" value={formData.residentialAddress} onChange={(v) => updateForm('residentialAddress', v)} />
              <Select
                label="Source"
                value={formData.source}
                onChange={(v) => updateForm('source', v)}
                options={[
                  { value: 'ONSITE', label: 'ONSITE' },
                  { value: 'ONLINE', label: 'ONLINE' },
                  { value: 'RECOMMENDATION', label: 'RECOMMENDATION' },
                ]}
              />
              <Select
                label="Payment channel"
                value={formData.paymentChannel}
                onChange={(v) => updateForm('paymentChannel', v)}
                options={[
                  { value: 'mpesaLipa', label: 'M-Pesa Lipa' },
                  { value: 'cash', label: 'Cash' },
                ]}
              />
              <Input label="Payment reference" required value={formData.paymentReference} onChange={(v) => updateForm('paymentReference', v)} placeholder="MPesa ref / receipt no" />
              <Input label="Payment received by" value={formData.paymentReceiverName} onChange={(v) => updateForm('paymentReceiverName', v)} placeholder="Staff name" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700/40" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400" onClick={createApplication}>Save application</button>
            </div>
          </div>
        </div>
      )}
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

function Input({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
  return (
    <label className="text-sm text-slate-300 flex flex-col gap-1">
      <span>{label}{required && <span className="text-rose-400"> *</span>}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900/50 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="text-sm text-slate-300 flex flex-col gap-1">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900/50 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

ReactDOM.createRoot(document.getElementById('newApplicationsRoot')).render(<NewApplicationsDashboard />);
