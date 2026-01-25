import { dbRefs, localTs, yyyymm, toast } from './workers_helpers.js';
import { ensureHtml2Pdf, uploadFileToStorage } from './workers_ui.js';
import { loadPolicies } from './workers_inventory.js';

let policiesCache = null;

const getRefs = () => dbRefs(firebase.database());

async function ensurePolicies() {
  if (policiesCache) return policiesCache;
  policiesCache = await loadPolicies();
  return policiesCache;
}

export async function computePayrollForWorker(workerId, monthKey) {
  const refs = getRefs();
  const [profileSnap, penaltiesSnap, payrollRunSnap, payslipSnap] = await Promise.all([
    refs.workerProfile(workerId).once('value'),
    refs.penaltiesLedgerMonth(workerId, monthKey).once('value'),
    refs.payrollRun(monthKey).once('value'),
    refs.payslip(workerId, monthKey).once('value')
  ]);

  const profile = profileSnap.exists() ? profileSnap.val() : {};
  const baseSalary = Number(profile.baseSalary || 0);

  let penalties = 0;
  if (penaltiesSnap.exists()) {
    Object.values(penaltiesSnap.val()).forEach(entry => {
      penalties += Number(entry.amountTZS || 0);
    });
  }

  const payrollRun = payrollRunSnap.val() || {};
  const runItem = payrollRun.items?.[workerId] || {};
  const advances = Number(runItem.advances || 0);

  const policies = await ensurePolicies();
  const statutory = computeStatutory(baseSalary, policies);

  const net = Math.max(
    baseSalary - penalties - advances - statutory.total,
    0
  );

  const result = {
    workerId,
    profile,
    baseSalary,
    penalties,
    advances,
    statutory,
    net,
    monthKey,
    existingPayslip: payslipSnap.exists() ? payslipSnap.val() : null
  };

  return result;
}

function computeStatutory(baseSalary, policies) {
  const statutoryPolicy = policies?.statutory?.tz || {};
  const wcfRate = Number(statutoryPolicy.wcfRate || 0) / 100;
  const nssfEmployeeRate = Number(statutoryPolicy.nssfEmployeeRate || 0) / 100;
  const nssfEmployerRate = Number(statutoryPolicy.nssfEmployerRate || 0) / 100;

  const wcf = roundCurrency(baseSalary * wcfRate);
  const nssfEmployee = roundCurrency(baseSalary * nssfEmployeeRate);
  const nssfEmployer = roundCurrency(baseSalary * nssfEmployerRate);

  // PAYE table not yet defined
  const paye = 0;

  return {
    wcf,
    nssf: {
      employee: nssfEmployee,
      employer: nssfEmployer
    },
    paye,
    total: roundCurrency(wcf + nssfEmployee + paye)
  };
}

function roundCurrency(value) {
  return Math.round(Number(value || 0));
}

export async function generatePayslip(workerId, monthKey, payrollData) {
  await ensureHtml2Pdf();

  const { profile, baseSalary, penalties, advances, statutory, net } = payrollData;
  const y = monthKey.slice(0, 4);
  const m = monthKey.slice(4);
  const filename = `${profile.fullNameUpper || workerId}-payslip-${monthKey}.pdf`;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.innerHTML = `
    <section style="font-family:'Segoe UI',Arial,sans-serif;padding:24px;max-width:680px;line-height:1.5;">
      <header style="text-align:center;margin-bottom:16px;">
        <h1 style="margin:0;font-size:22px;">SoMAp Payslip</h1>
        <p style="margin:4px 0;">${y}-${m}</p>
      </header>
      <article>
        <p><strong>Worker:</strong> ${profile.fullNameUpper || ''}</p>
        <p><strong>Role:</strong> ${profile.role || ''}</p>
        <p><strong>Base Salary:</strong> ${baseSalary.toLocaleString('en-US')} TZS</p>
        <p><strong>Penalties:</strong> ${penalties.toLocaleString('en-US')} TZS</p>
        <p><strong>Advances:</strong> ${advances.toLocaleString('en-US')} TZS</p>
        <p><strong>Statutory (Employee):</strong> ${statutory.total.toLocaleString('en-US')} TZS</p>
        <p><strong>Net Pay:</strong> ${net.toLocaleString('en-US')} TZS</p>
      </article>
    </section>
  `;
  document.body.appendChild(container);

  const blob = await window.html2pdf().set({
    margin: 10,
    filename,
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(container).toPdf().output('blob');

  container.remove();

  const storagePath = `payslips/${workerId}/${filename}`;
  const downloadUrl = await uploadFileToStorage(blob, storagePath);

  await getRefs().payslip(workerId, monthKey).set({
    base: baseSalary,
    items: [
      { label: 'penalties', amountTZS: penalties },
      { label: 'advances', amountTZS: advances },
      { label: 'statutory', amountTZS: statutory.total }
    ],
    net,
    generatedTs: localTs(),
    pdfUrl: downloadUrl
  });

  return downloadUrl;
}

export async function upsertPayrollRun(monthKey, items) {
  const totals = items.reduce(
    (acc, item) => {
      acc.grossTZS += Number(item.baseSalary || 0);
      acc.deductionsTZS += Number(item.penalties || 0) + Number(item.advances || 0) + Number(item.statutory?.total || 0);
      acc.netTZS += Number(item.net || 0);
      return acc;
    },
    { grossTZS: 0, deductionsTZS: 0, netTZS: 0 }
  );

  const runItems = items.reduce((acc, item) => {
    acc[item.workerId] = {
      base: item.baseSalary,
      deductions: item.penalties + item.advances + item.statutory.total,
      advances: item.advances,
      statutory: {
        nssf: item.statutory.nssf.employee,
        wcf: item.statutory.wcf,
        paye: item.statutory.paye
      },
      net: item.net,
      slipUrl: item.slipUrl || ''
    };
    return acc;
  }, {});

  await getRefs().payrollRun(monthKey).update({
    status: 'draft',
    createdTs: firebase.database.ServerValue.TIMESTAMP,
    totals,
    items: runItems
  });
  toast('Payroll run saved as draft', 'success');
}

export async function finalizePayrollRun(monthKey) {
  await getRefs().payrollRun(monthKey).update({
    status: 'finalized',
    finalizedTs: localTs()
  });
  toast('Payroll run finalized', 'success');
}


