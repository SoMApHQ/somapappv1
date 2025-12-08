// React dashboard for Joining & New Applicants (no JSX / Babel required)
(function () {
  'use strict';

  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
    const msg = 'React not loaded. Check CDN connectivity.';
    console.error(msg);
    const fallback = document.getElementById('newApplicationsRoot');
    if (fallback) fallback.textContent = msg;
    return;
  }

  const { useState, useEffect, useMemo } = React;
  const currency = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0 });
  const L = (v) => String(v || '').trim().toLowerCase();
  const h = React.createElement;
  const CLASS_OPTIONS = ['Baby Class','Middle Class','Pre Unit Class','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6','Class 7'];
  const GENDER_OPTIONS = ['Male','Female','Other'];

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
    select.onchange = (e) => onChange(String(e.target.value));
  }

  function useSchoolId() {
    const [schoolId, setSchoolId] = useState(() => (window.JoiningService?.resolveSchoolId?.() || 'socrates'));
    useEffect(() => {
      const label = document.getElementById('schoolLabel');
      if (label) label.textContent = schoolId;
      if (!window.currentSchoolId) window.currentSchoolId = schoolId;
    }, [schoolId]);
    return schoolId;
  }

  function formatCurrency(amount) {
    return `TSh ${currency.format(Number(amount || 0))}`;
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
  const [editingId, setEditingId] = useState(null);
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
    joiningFeeAmount: '',
  });
    const db = window.db || (window.firebase && window.firebase.database ? window.firebase.database() : null);

    useEffect(() => {
      initYearSelect(year, (nextYear) => {
        setYear(nextYear);
        window.somapYearContext?.setSelectedYear?.(nextYear, { manual: true });
      });
      const listener = (e) => setYear(String(e.detail || window.somapYearContext?.getSelectedYear?.() || year));
      window.addEventListener('somapYearChanged', listener);
      return () => window.removeEventListener('somapYearChanged', listener);
    }, []);

    useEffect(() => {
      if (!db || !window.JoiningService) {
        setError('Database not available');
        setLoading(false);
        return;
      }
      setLoading(true);
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

    useEffect(() => {
      if (settings && !editingId && !formData.joiningFeeAmount) {
        setFormData((prev) => ({ ...prev, joiningFeeAmount: settings.joiningFeeAmount || '' }));
      }
    }, [settings]);

    const filtered = useMemo(() => apps.filter((a) => {
      if (a.paymentVerificationStatus !== 'verified') return false;
      if (['rejected', 'no_show'].includes(a.status)) return false;
      return true;
    }), [apps]);

    const metrics = useMemo(() => {
      const verified = apps.filter((a) => a.paymentVerificationStatus === 'verified');
      const awaiting = verified.filter((a) => ['paid_form_issued', 'awaiting_admission'].includes(a.status));
      const admitted = verified.filter((a) => a.status === 'admitted');
      const totalFees = verified.reduce((sum, a) => sum + Number(a.joiningFeeAmount || 0), 0);
      const pendingList = apps.filter((a) => a.paymentVerificationStatus !== 'verified' && !['rejected', 'no_show'].includes(a.status));
      const pendingAmount = pendingList.reduce((sum, a) => sum + Number(a.joiningFeeAmount || 0), 0);
      return {
        total: apps.length,
        verified: verified.length,
        awaiting: awaiting.length,
        admitted: admitted.length,
        totalFees,
        pendingAmount,
        pendingCount: pendingList.length,
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
      const required = ['childFirstName', 'childLastName', 'classLevel', 'parentFullName', 'parentPhone', 'paymentReference', 'joiningFeeAmount'];
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
          joiningFeeAmount: formData.joiningFeeAmount ? Number(formData.joiningFeeAmount) : feeAmount,
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
        setEditingId(null);
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
          joiningFeeAmount: '',
        });
        alert('Application recorded. Awaiting payment verification.');
      } catch (err) {
        console.error(err);
        alert('Failed to create application: ' + (err.message || err));
      }
    }

    function startEdit(app) {
      setEditingId(app.id);
      setFormData({
        childFirstName: app.childFirstName || '',
        childMiddleName: app.childMiddleName || '',
        childLastName: app.childLastName || '',
        gender: app.gender || '',
        dateOfBirth: app.dateOfBirth || '',
        classLevel: app.classLevel || '',
        parentFullName: app.parentFullName || '',
        parentPhone: app.parentPhone || '',
        parentEmail: app.parentEmail || '',
        residentialAddress: app.residentialAddress || '',
        source: app.source || 'ONSITE',
        paymentChannel: app.paymentChannel || 'mpesaLipa',
        paymentReference: app.paymentReference || '',
        paymentReceiverName: app.paymentReceiverName || '',
        joiningFeeAmount: app.joiningFeeAmount || settings?.joiningFeeAmount || '',
      });
      setFormOpen(true);
    }

    async function saveEdit() {
      const required = ['childFirstName', 'childLastName', 'classLevel', 'parentFullName', 'parentPhone', 'paymentReference'];
      const missing = required.filter((k) => !String(formData[k] || '').trim());
      if (missing.length) {
        alert('Fill all required fields: ' + missing.join(', '));
        return;
      }
      try {
        await window.JoiningService.updateJoiningApplication(year, editingId, {
          ...formData,
          joiningFeeAmount: formData.joiningFeeAmount ? Number(formData.joiningFeeAmount) : formData.joiningFeeAmount,
          lastUpdatedAt: Date.now(),
        });
        setFormOpen(false);
        setEditingId(null);
      } catch (err) {
        console.error(err);
        alert('Failed to update: ' + (err.message || err));
      }
    }

    async function deleteApplication(app) {
      if (!window.JoiningService) return;
      const ok = confirm('Delete this application permanently?');
      if (!ok) return;
      try {
        await window.JoiningService.deleteJoiningApplication(year, app.id);
      } catch (err) {
        console.error(err);
        alert('Failed to delete: ' + (err.message || err));
      }
    }

    function updateForm(key, value) {
      setFormData((prev) => ({ ...prev, [key]: value }));
    }

    return h('div', { className: 'space-y-6' }, [
      h('div', { key: 'top', className: 'flex flex-wrap items-center justify-between gap-3' }, [
        h('div', { className: 'glass px-4 py-3 border border-slate-700/60 rounded-xl' }, [
          h('p', { className: 'text-xs text-slate-400' }, `Joining fee (${year})`),
          h('p', { className: 'text-lg font-semibold text-white' }, settings ? formatCurrency(settings.joiningFeeAmount || 0) : '—'),
          h('p', { className: 'text-[11px] text-slate-500' }, `Mpesa Lipa Namba: ${settings?.mpesaLipaNumber || '13768688'}`),
        ]),
        h('button', {
          className: 'px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-slate-900 font-semibold shadow-lg hover:shadow-sky-500/30',
          onClick: () => {
            setEditingId(null);
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
            setFormOpen(true);
          },
        }, 'Record new application'),
      ]),

      h('div', { key: 'finance-pulse', className: 'grid gap-4 md:grid-cols-2' }, [
        h('div', { className: 'glass p-4 border border-slate-700/60 rounded-xl' }, [
          h('div', { className: 'flex items-center justify-between' }, [
            h('div', null, [
              h('p', { className: 'text-xs uppercase tracking-[0.14em] text-slate-400' }, 'Joining Form Collection'),
              h('p', { className: 'text-2xl font-semibold text-white mt-1' }, formatCurrency(metrics.totalFees)),
              h('p', { className: 'text-xs text-slate-400 mt-1' }, 'Approved / Verified'),
            ]),
            h('div', { className: 'text-right' }, [
              h('p', { className: 'text-xs text-slate-400' }, 'Pending to approve'),
              h('p', { className: 'text-lg font-semibold text-amber-200' }, `${metrics.pendingCount} pending`),
              h('p', { className: 'text-sm text-amber-200/80' }, formatCurrency(metrics.pendingAmount)),
            ]),
          ]),
          h('div', { className: 'mt-3 text-xs text-slate-400 flex items-center gap-2' }, [
            h('i', { className: 'fas fa-shield-halved text-sky-300' }),
            h('span', null, 'Approvals protect your books. Pending items are verified in the approvals center.'),
          ]),
        ]),
      ]),

      h('div', { key: 'metrics', className: 'grid gap-4 md:grid-cols-2 xl:grid-cols-4' }, [
        h(MetricCard, { label: 'Total applications', value: metrics.total, hint: `All sources, ${year}` }),
        h(MetricCard, { label: 'Verified (paid)', value: metrics.verified, hint: 'paymentVerificationStatus = verified' }),
        h(MetricCard, { label: 'Awaiting admission', value: metrics.awaiting, hint: 'Paid, not yet admitted' }),
        h(MetricCard, { label: 'Joining fees collected', value: formatCurrency(metrics.totalFees), hint: 'Verified payments only' }),
      ]),

      error ? h('div', { className: 'glass border border-rose-500/40 text-rose-100 p-4 rounded-xl' }, error) : null,

      h(Section, { title: 'New Applicants', subtitle: 'Verified, ready for admission', count: filtered.length }, [
        loading ? h('div', { className: 'text-slate-300 text-sm' }, 'Loading applications…') :
          (filtered.length === 0 ? h('div', { className: 'text-slate-400 text-sm' }, `No verified applications for ${year} yet.`) :
            h('div', { className: 'overflow-x-auto' }, [
              h('table', { className: 'min-w-full text-sm' }, [
                h('thead', { className: 'bg-slate-900/60' }, h('tr', null, [
                  h(Th, null, 'Child'),
                  h(Th, null, 'Class'),
                  h(Th, null, 'Parent'),
                  h(Th, null, 'Phone'),
                  h(Th, null, 'Source'),
                  h(Th, null, 'Status'),
                  h(Th, null, 'Joining Fee'),
                  h(Th, null, 'Downloads'),
                  h(Th, null, 'Actions'),
                ])),
                h('tbody', null, filtered.map((app) => {
                  const pill = statusPill(app.status);
                  return h('tr', { key: app.id, className: 'border-b border-slate-800/80 hover:bg-slate-800/40 transition' }, [
                    h(Td, null, [
                      h('div', { className: 'font-semibold text-slate-100' }, [app.childFirstName, app.childMiddleName, app.childLastName].filter(Boolean).join(' ')),
                      h('div', { className: 'text-xs text-slate-400' }, `${app.gender || ''} • ${app.dateOfBirth || ''}`),
                    ]),
                    h(Td, null, app.classLevel || '—'),
                    h(Td, null, app.parentFullName || '—'),
                    h(Td, { className: 'font-mono text-xs' }, app.parentPhone || '—'),
                    h(Td, null, h('span', { className: 'uppercase text-xs tracking-wide text-slate-300' }, app.source || 'ONLINE')),
                    h(Td, null, [
                      h('span', { className: `pill ${pill.tone}` }, pill.label),
                      h('div', { className: 'text-[11px] text-slate-400 mt-1 capitalize' }, `Payment: ${app.paymentVerificationStatus || 'pending'}`),
                    ]),
                    h(Td, null, formatCurrency(app.joiningFeeAmount || 0)),
                    h(Td, null, app.downloadCount || 0),
                    h(Td, null, h('div', { className: 'flex flex-wrap gap-2' }, [
                      h('button', {
                        className: 'px-3 py-1 rounded-lg bg-slate-700/40 text-slate-200 text-xs border border-slate-500/40 hover:bg-slate-600/60',
                        onClick: () => startEdit(app),
                      }, 'Edit'),
                      h('button', {
                        className: 'px-3 py-1 rounded-lg bg-rose-600/30 text-rose-50 text-xs border border-rose-400/40 hover:bg-rose-600/40',
                        onClick: () => deleteApplication(app),
                      }, 'Delete'),
                      h('button', {
                        className: 'px-3 py-1 rounded-lg bg-sky-500/20 text-sky-100 text-xs border border-sky-400/40 hover:bg-sky-500/30',
                        onClick: () => importToAdmission(app),
                      }, 'Import'),
                    ])),
                  ]);
                })),
              ]),
            ]))
      ]),

      h(Section, { title: 'Leads / Pending', subtitle: 'Awaiting payment verification', count: pending.length }, [
        pending.length === 0 ? h('div', { className: 'text-slate-400 text-sm' }, 'No pending payments.') :
          h('div', { className: 'overflow-x-auto' }, [
            h('table', { className: 'min-w-full text-sm' }, [
              h('thead', { className: 'bg-slate-900/60' }, h('tr', null, [
                h(Th, null, 'Child'),
                h(Th, null, 'Class'),
                h(Th, null, 'Parent'),
                h(Th, null, 'Phone'),
                h(Th, null, 'Source'),
                h(Th, null, 'Payment Ref'),
                h(Th, null, 'Actions'),
              ])),
              h('tbody', null, pending.map((app) =>
                h('tr', { key: app.id, className: 'border-b border-slate-800/80 hover:bg-slate-800/40 transition' }, [
                  h(Td, null, [
                    h('div', { className: 'font-semibold text-slate-100' }, [app.childFirstName, app.childMiddleName, app.childLastName].filter(Boolean).join(' ')),
                    h('div', { className: 'text-xs text-slate-400' }, app.classLevel || '—'),
                  ]),
                  h(Td, null, app.classLevel || '—'),
                  h(Td, null, app.parentFullName || '—'),
                  h(Td, { className: 'font-mono text-xs' }, app.parentPhone || '—'),
                  h(Td, null, h('span', { className: 'uppercase text-xs tracking-wide text-slate-300' }, app.source || 'ONLINE')),
                  h(Td, { className: 'font-mono text-xs' }, app.paymentReference || '—'),
                  h(Td, null, h('div', { className: 'flex flex-wrap gap-2' }, [
                    h('button', {
                      className: 'px-3 py-1 rounded-lg bg-slate-700/40 text-slate-200 text-xs border border-slate-500/40 hover:bg-slate-600/60',
                      onClick: () => startEdit(app),
                    }, 'Edit'),
                    h('button', {
                      className: 'px-3 py-1 rounded-lg bg-rose-600/30 text-rose-50 text-xs border border-rose-400/40 hover:bg-rose-600/40',
                      onClick: () => deleteApplication(app),
                    }, 'Delete'),
                  ])),
                ])
              )),
            ]),
          ])
      ]),

      formOpen ? h(FormModal, {
        formData,
        editing: editingId,
        onClose: () => { setFormOpen(false); setEditingId(null); },
        onSave: () => (editingId ? saveEdit() : createApplication()),
        onChange: updateForm,
      }) : null,
    ]);
  }

  function MetricCard({ label, value, hint }) {
    return h('div', { className: 'glass p-4' }, [
      h('p', { className: 'text-xs uppercase tracking-[0.14em] text-slate-400' }, label),
      h('p', { className: 'text-2xl font-semibold text-white mt-1' }, value),
      h('p', { className: 'text-xs text-slate-400 mt-1' }, hint),
    ]);
  }

  function Section({ title, subtitle, count, children }) {
    return h('div', { className: 'glass p-4 space-y-3' }, [
      h('div', { className: 'flex items-center justify-between gap-3' }, [
        h('div', null, [
          h('p', { className: 'text-sm text-slate-300' }, subtitle),
          h('h2', { className: 'text-xl font-semibold text-white' }, title),
        ]),
        h('div', { className: 'text-right' }, [
          h('p', { className: 'text-xs text-slate-400' }, 'Count'),
          h('p', { className: 'text-lg font-semibold text-slate-100' }, count),
        ]),
      ]),
      ...(Array.isArray(children) ? children : [children]),
    ]);
  }

  function Th(props) {
    return h('th', {
      className: 'text-left text-[11px] uppercase tracking-[0.14em] text-slate-300 px-3 py-2 border-b border-slate-800/70',
    }, props.children);
  }

  function Td(props) {
    return h('td', { className: 'px-3 py-3 align-top text-slate-100/90 text-sm ' + (props.className || '') }, props.children);
  }

  function FormModal({ formData, onClose, onSave, onChange, editing }) {
    return h('div', { className: 'fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-3' }, [
      h('div', { className: 'glass w-full max-w-3xl p-5 relative max-h-[85vh] overflow-y-auto' }, [
        h('button', { className: 'absolute top-3 right-3 text-slate-400 hover:text-white', onClick: onClose }, h('i', { className: 'fas fa-times' })),
        h('h3', { className: 'text-xl font-semibold text-white mb-1' }, editing ? 'Edit application' : 'Record joining application'),
        h('p', { className: 'text-sm text-slate-400 mb-4' }, 'Onsite / recommendation / online intake with payment reference.'),
        h('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-3' }, [
          h(Input, { label: 'First name', required: true, value: formData.childFirstName, onChange: (v) => onChange('childFirstName', v) }),
          h(Input, { label: 'Middle name', value: formData.childMiddleName, onChange: (v) => onChange('childMiddleName', v) }),
          h(Input, { label: 'Last name', required: true, value: formData.childLastName, onChange: (v) => onChange('childLastName', v) }),
          h(Select, {
            label: 'Gender',
            value: formData.gender,
            onChange: (v) => onChange('gender', v),
            options: GENDER_OPTIONS.map((g) => ({ value: g, label: g })),
          }),
          h(Input, { label: 'Date of birth', type: 'date', value: formData.dateOfBirth, onChange: (v) => onChange('dateOfBirth', v) }),
          h(Select, {
            label: 'Class level',
            required: true,
            value: formData.classLevel,
            onChange: (v) => onChange('classLevel', v),
            options: CLASS_OPTIONS.map((c) => ({ value: c, label: c })),
          }),
          h(Input, { label: 'Parent full name', required: true, value: formData.parentFullName, onChange: (v) => onChange('parentFullName', v) }),
          h(Input, { label: 'Parent phone', required: true, value: formData.parentPhone, onChange: (v) => onChange('parentPhone', v), placeholder: '+2557...' }),
          h(Input, { label: 'Parent email', value: formData.parentEmail, onChange: (v) => onChange('parentEmail', v) }),
          h(Input, { label: 'Residential address', value: formData.residentialAddress, onChange: (v) => onChange('residentialAddress', v) }),
          h(Select, {
            label: 'Source',
            value: formData.source,
            onChange: (v) => onChange('source', v),
            options: [
              { value: 'ONSITE', label: 'ONSITE' },
              { value: 'ONLINE', label: 'ONLINE' },
              { value: 'RECOMMENDATION', label: 'RECOMMENDATION' },
            ],
          }),
          h(Select, {
            label: 'Payment channel',
            value: formData.paymentChannel,
            onChange: (v) => onChange('paymentChannel', v),
            options: [
              { value: 'mpesaLipa', label: 'M-Pesa Lipa' },
              { value: 'cash', label: 'Cash' },
            ],
          }),
          h(Input, { label: 'Payment reference', required: true, value: formData.paymentReference, onChange: (v) => onChange('paymentReference', v), placeholder: 'MPesa ref / receipt no' }),
          h(Input, { label: 'Payment received by', value: formData.paymentReceiverName, onChange: (v) => onChange('paymentReceiverName', v), placeholder: 'Staff name' }),
          h(Input, { label: 'Amount paid (TZS)', type: 'number', required: true, value: formData.joiningFeeAmount, onChange: (v) => onChange('joiningFeeAmount', v), placeholder: settings?.joiningFeeAmount || '7000' }),
        ]),
        h('div', { className: 'mt-4 flex flex-wrap items-center justify-between gap-3' }, [
          h('div', { className: 'text-xs text-slate-400 flex items-center gap-2' }, [
            h('i', { className: 'fas fa-circle-info text-slate-300' }),
            h('span', null, 'Scroll to see all fields. Delete is available on each card row.'),
          ]),
          h('div', { className: 'flex justify-end gap-2' }, [
            h('button', { className: 'px-4 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700/40', onClick: onClose }, 'Cancel'),
            h('button', { className: 'px-4 py-2 rounded-lg bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400', onClick: onSave }, editing ? 'Save changes' : 'Save application'),
          ]),
        ]),
      ]),
    ]);
  }

  function Input({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
    return h('label', { className: 'text-sm text-slate-300 flex flex-col gap-1' }, [
      h('span', null, [label, required ? h('span', { className: 'text-rose-400' }, ' *') : null]),
      h('input', {
        type,
        value,
        placeholder,
        onChange: (e) => onChange(e.target.value),
        className: 'w-full bg-slate-900/50 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500',
      }),
    ]);
  }

  function Select({ label, value, onChange, options }) {
    return h('label', { className: 'text-sm text-slate-300 flex flex-col gap-1' }, [
      h('span', null, label),
      h('select', {
        value,
        onChange: (e) => onChange(e.target.value),
        className: 'w-full bg-slate-900/50 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500',
      }, options.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label))),
    ]);
  }

  ReactDOM.createRoot(document.getElementById('newApplicationsRoot')).render(h(NewApplicationsDashboard));
})();
