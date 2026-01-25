import { dbRefs, localTs } from './workers_helpers.js';
import { ensureHtml2Pdf, uploadFileToStorage } from './workers_ui.js';

const getRefs = () => dbRefs(firebase.database());

export const CONTRACT_LANGUAGE_BY_ROLE = {
  teacher: 'en',
  accountant: 'en',
  manager: 'en',
  academic: 'en',
  secretary: 'en',
  hr: 'en',
  admin: 'en',
  driver: 'sw',
  cook: 'sw',
  cleaner: 'sw',
  guard: 'sw',
  storekeeper: 'en'
};

const TEMPLATE_BY_ROLE = {
  driver: 'driver',
  cook: 'cook',
  cleaner: 'cleaner',
  guard: 'guard',
  teacher: 'teacher',
  accountant: 'accountant',
  manager: 'manager',
  academic: 'academic',
  secretary: 'secretary',
  hr: 'secretary',
  storekeeper: 'manager'
};

/**
 * Calculate salary breakdown.
 * - If passed a number, splits 2/3 salary + 1/3 other.
 * - If passed terms, uses roleSalary + responsibilityAllowance.
 * NSSF applies only to role salary.
 */
export function calculateSalaryBreakdown(baseSalaryOrTerms) {
  const isTerms = baseSalaryOrTerms && typeof baseSalaryOrTerms === 'object';
  const roleSalary = isTerms ? Number(baseSalaryOrTerms.roleSalary || 0) : 0;
  const allowance = isTerms ? Number(baseSalaryOrTerms.responsibilityAllowance || 0) : 0;
  const base = isTerms ? roleSalary + allowance : Number(baseSalaryOrTerms) || 0;
  const other = isTerms ? allowance : Math.round(base / 3);
  const salary = isTerms ? roleSalary : base - other;
  const nssfEmployeePercent = isTerms ? Number(baseSalaryOrTerms.nssfEmployeePercent ?? 0.10) : 0.10;
  const nssfEmployerPercent = isTerms ? Number(baseSalaryOrTerms.nssfEmployerPercent ?? 0.10) : 0.10;
  const nssfEmployee = Math.round(salary * nssfEmployeePercent);
  const nssfEmployer = Math.round(salary * nssfEmployerPercent);
  const nssfTotal = nssfEmployee + nssfEmployer;
  const netSalary = salary - nssfEmployee + other;
  
  return {
    baseSalary: base,
    salary,
    other,
    nssfEmployee,
    nssfEmployer,
    nssfTotal,
    netSalary
  };
}

/**
 * Get current date in readable format
 */
function getTodayFormatted() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Full contract template - ACCOUNTANT (English)
 */
const ACCOUNTANT_TEMPLATE_EN = ({ fullName, phone, baseSalary, salary, other, nssfEmployee, nssfEmployer, nssfTotal, netSalary, signatureUrl }) => `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 210mm; margin: auto; padding: 20mm; background: white; color: #1e293b; line-height: 1.65; font-size: 11pt;">
  
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="width: 80px; height: 80px; margin: 0 auto 16px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 900; color: white;">So</div>
    <h1 style="margin: 0; font-size: 24pt; font-weight: 700; color: #4f46e5;">SOCRATES PRE & PRIMARY SCHOOL</h1>
    <p style="margin: 4px 0 0; color: #64748b;">P.O. Box 14256, Arusha, Tanzania<br>Phone: +255 686828732 / 0689649822<br>Email: socratesschool2020@gmail.com</p>
  </div>

  <div style="text-align: center; margin: 32px 0; padding: 16px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(124, 58, 237, 0.1)); border-left: 4px solid #4f46e5; border-radius: 8px;">
    <h2 style="margin: 0; font-size: 20pt; font-weight: 700; color: #4f46e5;">EMPLOYMENT CONTRACT — ACCOUNTANT</h2>
    <p style="margin: 8px 0 0; color: #64748b;">Effective Date: ${getTodayFormatted()}<br>Place of Signature: Arusha, Tanzania</p>
  </div>

  <div style="margin: 24px 0; padding: 16px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px;">
    <p style="margin: 0; font-weight: 600; color: #92400e;">CONFIDENTIAL — INTERNAL HR DOCUMENT</p>
  </div>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">RECITALS</h3>
  <p><strong>A.</strong> The Employee commences employment with the Employer on the Effective Date stated above.</p>
  <p><strong>B.</strong> The Parties wish to set out clear terms of employment for the avoidance of doubt.</p>
  <p><strong>C.</strong> This Agreement governs the employment relationship from the Effective Date forward.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">1. APPOINTMENT, COMMENCEMENT & PROBATION</h3>
  <p><strong>1.1 Appointment.</strong> The Employer appoints <strong>${fullName}</strong> as <strong>Accountant</strong> effective the Effective Date.</p>
  <p><strong>1.2 Probation.</strong> The Employee is on probation for three (3) months from the Effective Date. The Employer may extend probation once by up to one (1) month with written reasons.</p>
  <p><strong>1.3 Standards during probation.</strong> The Employee must meet all duties and Key Performance Indicators (KPIs) described in this Agreement and in the Employer's Handbook/SOPs.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">2. PLACE OF WORK & HOURS</h3>
  <p><strong>2.1 Workplace.</strong> School Office, Arusha, and any other location reasonably assigned.</p>
  <p><strong>2.2 Hours.</strong> Monday–Friday, arrival before 07:20 and departure after 16:30; Saturday 08:00–13:00 (as scheduled). Reporting before 07:20 and signing the register is mandatory in SoMAp.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">3. REMUNERATION & STATUTORY DEDUCTIONS</h3>
  <div style="padding: 16px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1)); border-radius: 12px; margin: 16px 0;">
    <p style="margin: 0 0 12px; font-size: 13pt; font-weight: 700; color: #065f46;">Salary Breakdown</p>
    <table style="width: 100%; border-collapse: collapse; margin: 0;">
      <tr style="background: rgba(255,255,255,0.7);">
        <td style="padding: 8px; border: 1px solid #d1fae5;"><strong>Base Salary (Total)</strong></td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right; font-weight: 700; color: #047857;">TZS ${Number(baseSalary).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #d1fae5;">  ? Salary (Accounting Role)</td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right;">TZS ${Number(salary).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #d1fae5;">  ? Other (Responsibilities Allowance)</td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right;">TZS ${Number(other).toLocaleString('en-US')}</td>
      </tr>
      <tr style="background: rgba(239, 68, 68, 0.1);">
        <td style="padding: 8px; border: 1px solid #fee2e2;"><strong>NSSF Deductions (from Salary only)</strong></td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right;"></td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Employee Contribution (10%)</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #dc2626;">- TZS ${Number(nssfEmployee).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Employer Contribution (10%)</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #047857;">+ TZS ${Number(nssfEmployer).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Total NSSF Monthly</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; font-weight: 700;">TZS ${Number(nssfTotal).toLocaleString('en-US')}</td>
      </tr>
      <tr style="background: rgba(79, 70, 229, 0.15);">
        <td style="padding: 12px; border: 2px solid #4f46e5; font-weight: 700; font-size: 12pt; color: #4f46e5;"><strong>NET SALARY (After NSSF)</strong></td>
        <td style="padding: 12px; border: 2px solid #4f46e5; text-align: right; font-weight: 700; font-size: 12pt; color: #4f46e5;">TZS ${Number(netSalary).toLocaleString('en-US')}</td>
      </tr>
    </table>
  </div>
  <p><strong>3.2 Payment.</strong> Salary is payable on/before the 8th of each month.</p>
  <p><strong>3.3 Benefits.</strong> Meals at school; and school tuition fee benefit for one child as per School policy.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">4. DUTIES & KPIs</h3>
  <p><strong>4.1 SoMAp & Records.</strong> Enter all pupil admissions/fees into SoMAp the same day. Backlog clearance is a priority obligation.</p>
  <p><strong>4.2 Daily Form.</strong> Complete and submit daily accounting form covering cash received, receipts issued, deposits, and reconciliation notes.</p>
  <p><strong>4.3 Fees & Arrears.</strong> Daily follow-ups: = 25 parents/day; Weekly arrears report every Friday 10:00.</p>
  <p><strong>4.4 Compliance.</strong> NSSF/TRA submissions, payroll accuracy, monthly statutory returns, audit support.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">5. CONDUCT & DISCIPLINE</h3>
  <p>Misconduct includes insubordination, unauthorised absence, falsification of records, breach of confidentiality, cash mishandling. Process: show-cause ? hearing ? written outcome. Sanctions may include warnings, suspension, or termination.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">6. LEAVE & ATTENDANCE</h3>
  <p><strong>6.1 Annual Leave.</strong> As per law; schedule by agreement.</p>
  <p><strong>6.2 Sick Leave.</strong> As per law with medical documentation.</p>
  <p><strong>6.3 Absence Rule.</strong> Unauthorised absence for 3 consecutive days without permission: <strong>IMMEDIATE TERMINATION</strong>.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">7. NOTICE & TERMINATION</h3>
  <p>Either party may terminate by 28 days' written notice or payment in lieu. After fair hearing, employment may be terminated for incapacity or gross misconduct.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">8. CONFIDENTIALITY</h3>
  <p>All financial/student/parent/staff information is strictly confidential. This obligation survives termination.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">9. GOVERNING LAW</h3>
  <p>Laws of Tanzania. Disputes: Commission for Mediation and Arbitration (CMA) and Labour Court.</p>

  <div style="margin-top: 48px; page-break-inside: avoid;">
    <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">10. SIGNATURES</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px;">
      <div>
        <p style="margin: 0 0 40px;"><strong>Employer (Director):</strong></p>
        <p style="border-top: 2px solid #1e293b; padding-top: 8px; margin: 0;">Signature: _______________________</p>
        <p style="margin: 4px 0 0;">Date: ${getTodayFormatted()}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px;"><strong>Employee (${fullName}):</strong></p>
        ${signatureUrl ? `<img src="${signatureUrl}" alt="Signature" style="max-width: 200px; max-height: 80px; border: 1px solid #e2e8f0; padding: 4px; border-radius: 4px; margin-bottom: 8px;" />` : '<p style="margin: 0 0 40px;"></p>'}
        <p style="border-top: 2px solid #1e293b; padding-top: 8px; margin: 0;">Date: ${getTodayFormatted()}</p>
      </div>
    </div>
  </div>

  <div style="margin-top: 32px; padding: 16px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.05), rgba(124, 58, 237, 0.05)); border-radius: 8px; text-align: center; color: #64748b; font-size: 9pt;">
    <p style="margin: 0;">This contract is digitally generated and managed by SoMAp · Socrates Pre & Primary School Management System</p>
    <p style="margin: 4px 0 0;">Worker Contact: ${phone || 'N/A'} | Generated: ${getTodayFormatted()}</p>
  </div>
</div>
`;

/**
 * Full contract template - TEACHER (English)
 */
const TEACHER_TEMPLATE_EN = ({ fullName, phone, baseSalary, salary, other, nssfEmployee, nssfEmployer, nssfTotal, netSalary, signatureUrl }) => `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 210mm; margin: auto; padding: 20mm; background: white; color: #1e293b; line-height: 1.65; font-size: 11pt;">
  
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="width: 80px; height: 80px; margin: 0 auto 16px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 900; color: white;">So</div>
    <h1 style="margin: 0; font-size: 24pt; font-weight: 700; color: #4f46e5;">SOCRATES PRE & PRIMARY SCHOOL</h1>
    <p style="margin: 4px 0 0; color: #64748b;">P.O. Box 14256, Arusha, Tanzania<br>Phone: +255 686828732 / 0689649822<br>Email: socratesschool2020@gmail.com</p>
  </div>

  <div style="text-align: center; margin: 32px 0; padding: 16px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(124, 58, 237, 0.1)); border-left: 4px solid #4f46e5; border-radius: 8px;">
    <h2 style="margin: 0; font-size: 20pt; font-weight: 700; color: #4f46e5;">CONTRACT OF EMPLOYMENT — TEACHER</h2>
    <p style="margin: 8px 0 0; color: #64748b;">Effective Date: ${getTodayFormatted()}<br>Place of Signature: Arusha, Tanzania</p>
  </div>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">PREAMBLE</h3>
  <p>WHEREAS the employer operates an educational institution and desires to offer employment to the employee,</p>
  <p>WHEREAS the employee is willing to serve the employer under the conditions set out in this contract,</p>
  <p>NOW THEREFORE, the parties agree as follows:</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">1. NATURE OF THE CONTRACT</h3>
  <p><strong>1.1 Probation Period:</strong> The Employee is on probation for three (3) months, which may be extended at the employer's discretion.</p>
  <p><strong>1.2 Full Contract:</strong> Upon successful completion of the probation period, the employee will be offered a one-year contract.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">2. POSITION</h3>
  <p>The school employs <strong>${fullName}</strong> as <strong>Teacher</strong>. The employee shall perform all duties as specified in this contract or as assigned by the employer/supervisor.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">3. HOURS OF WORK</h3>
  <p>The employee's work schedule will be determined by a duty roster and peak demands. Standard hours are 07:00–16:30 Monday to Friday, unless assigned as TOD (Teacher on Duty), with additional responsibilities as needed.</p>
  <p>If the employee is prevented from working due to illness or an accident, a medical certificate must be submitted. Failure to do so will result in the absence being treated as unauthorized leave.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">4. REMUNERATION</h3>
  <div style="padding: 16px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1)); border-radius: 12px; margin: 16px 0;">
    <p style="margin: 0 0 12px; font-size: 13pt; font-weight: 700; color: #065f46;">Salary Breakdown</p>
    <table style="width: 100%; border-collapse: collapse; margin: 0;">
      <tr style="background: rgba(255,255,255,0.7);">
        <td style="padding: 8px; border: 1px solid #d1fae5;"><strong>Base Salary (Total)</strong></td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right; font-weight: 700; color: #047857;">TZS ${Number(baseSalary).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #d1fae5;">  ? Salary (Teaching Role)</td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right;">TZS ${Number(salary).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #d1fae5;">  ? Other (Specific Appointment Allowance)</td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right;">TZS ${Number(other).toLocaleString('en-US')}</td>
      </tr>
      <tr style="background: rgba(239, 68, 68, 0.1);">
        <td style="padding: 8px; border: 1px solid #fee2e2;"><strong>NSSF Deductions (from Salary only)</strong></td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right;"></td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Employee Contribution (10%)</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #dc2626;">- TZS ${Number(nssfEmployee).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Employer Contribution (10%)</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #047857;">+ TZS ${Number(nssfEmployer).toLocaleString('en-US')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Total NSSF Monthly</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; font-weight: 700;">TZS ${Number(nssfTotal).toLocaleString('en-US')}</td>
      </tr>
      <tr style="background: rgba(79, 70, 229, 0.15);">
        <td style="padding: 12px; border: 2px solid #4f46e5; font-weight: 700; font-size: 12pt; color: #4f46e5;"><strong>NET SALARY (After NSSF)</strong></td>
        <td style="padding: 12px; border: 2px solid #4f46e5; text-align: right; font-weight: 700; font-size: 12pt; color: #4f46e5;">TZS ${Number(netSalary).toLocaleString('en-US')}</td>
      </tr>
    </table>
  </div>
  <p><strong>Note on Payment:</strong> Salary priority is given to timely payment; unless a clear report is given, there will be no salary delays.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">5. OTHER BENEFITS TO EMPLOYEE</h3>
  <ol style="padding-left: 20px;">
    <li>Daily meals, including tea and lunch.</li>
    <li>The employer covers school fees for one child, excluding food, health, and exam fees.</li>
  </ol>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">6. LEAVE</h3>
  <p><strong>6.1 Annual Leave:</strong> The employee is entitled to 28 consecutive days of paid leave after 12 months of employment, to be taken in December. Leave cannot be accumulated and must be taken in the year it is due.</p>
  <p><strong>6.2 Sick Leave:</strong> The employee is entitled to two months of paid sick leave in case of illness, followed by two months of half-pay if the illness continues. After a total of four months, the employer reserves the right to terminate the contract on medical grounds with proper documentation. Medical certificate from a recognized healthcare provider is required.</p>
  <p><strong>6.3 Maternity/Paternity Leave:</strong> Female employees are entitled to 84 days of maternity leave, and male employees to two weeks of paternity leave. Written notification and a doctor's report are required.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">7. TERMINATION OF EMPLOYMENT</h3>
  <p><strong>7.1 Notice:</strong> Either party may terminate this contract by providing one month's written notice. In cases where notice is not given, the party terminating the contract must provide one month's salary in lieu of notice.</p>
  <p><strong>7.2 Resignation:</strong> An employee wishing to resign must provide at least one month's written notice. Failure to provide required notice will result in the employee forfeiting any remaining salary or benefits for the period not worked.</p>
  <p><strong>7.3 Final Salary:</strong> In case of resignation or termination, the final salary will be paid based on actual days worked up to the last working day.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">8. CONFIDENTIALITY AND INTELLECTUAL PROPERTY</h3>
  <p>The employee agrees not to disclose or sell any intellectual property or confidential information belonging to the employer during employment period or after termination. Breach of this clause will result in immediate termination and a fine of TZS 1,000,000.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">9. RULES OF GOOD CONDUCT</h3>
  <p>Breach of the following rules may result in termination or salary deductions:</p>
  <ol style="padding-left: 20px;">
    <li>Absence without permission for more than three consecutive days.</li>
    <li>Insubordination or refusal to implement policies.</li>
    <li>Poor performance or failure to improve student results to meet the school's standards (81% average). The employee will have 90 days to improve student performance.</li>
    <li>Use of any language other than English on school premises will result in a TZS 30,000 salary deduction.</li>
  </ol>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">10. SOCIAL AFFAIRS</h3>
  <p>All employees are required to participate in social functions of colleagues, either through physical presence or contributions (not exceeding TZS 10,000). The institution will contribute TZS 20,000 or TZS 30,000 for such events.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">11. GOVERNING LAW</h3>
  <p>This contract is governed by the Laws of Tanzania.</p>

  <div style="margin-top: 48px; page-break-inside: avoid;">
    <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">12. EMPLOYMENT COMMITMENT & SIGNATURES</h3>
    <p style="margin-bottom: 32px;">I, <strong>${fullName}</strong>, hereby certify that I have read, understood, and agree to the terms of this contract.</p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px;">
      <div>
        <p style="margin: 0 0 40px;"><strong>Employer (Director):</strong></p>
        <p style="border-top: 2px solid #1e293b; padding-top: 8px; margin: 0;">Signature: _______________________</p>
        <p style="margin: 4px 0 0;">Date: ${getTodayFormatted()}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px;"><strong>Employee (${fullName}):</strong></p>
        ${signatureUrl ? `<img src="${signatureUrl}" alt="Signature" style="max-width: 200px; max-height: 80px; border: 1px solid #e2e8f0; padding: 4px; border-radius: 4px; margin-bottom: 8px;" />` : '<p style="margin: 0 0 40px;"></p>'}
        <p style="border-top: 2px solid #1e293b; padding-top: 8px; margin: 0;">Date: ${getTodayFormatted()}</p>
      </div>
    </div>
  </div>

  <div style="margin-top: 32px; padding: 16px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.05), rgba(124, 58, 237, 0.05)); border-radius: 8px; text-align: center; color: #64748b; font-size: 9pt;">
    <p style="margin: 0;">This contract is digitally generated and managed by SoMAp · Socrates Pre & Primary School Management System</p>
    <p style="margin: 4px 0 0;">Worker Contact: ${phone || 'N/A'} | Generated: ${getTodayFormatted()}</p>
  </div>
</div>
`;

/**
 * Full contract template - COOK (Swahili)
 */
const COOK_TEMPLATE_SW = ({ fullName, phone, baseSalary, salary, other, nssfEmployee, nssfEmployer, nssfTotal, netSalary, signatureUrl }) => `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 210mm; margin: auto; padding: 20mm; background: white; color: #1e293b; line-height: 1.65; font-size: 11pt;">
  
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="width: 80px; height: 80px; margin: 0 auto 16px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 900; color: white;">So</div>
    <h1 style="margin: 0; font-size: 24pt; font-weight: 700; color: #4f46e5;">SOCRATES PRE & PRIMARY SCHOOL</h1>
    <p style="margin: 4px 0 0; color: #64748b;">S.L.P 14256, Arusha, Tanzania<br>Simu: +255 686828732 / 0689649822<br>Barua pepe: socratesschool2020@gmail.com</p>
  </div>

  <div style="text-align: center; margin: 32px 0; padding: 16px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(124, 58, 237, 0.1)); border-left: 4px solid #4f46e5; border-radius: 8px;">
    <h2 style="margin: 0; font-size: 20pt; font-weight: 700; color: #4f46e5;">MKATABA WA AJIRA KWA MPISHI</h2>
    <p style="margin: 8px 0 0; color: #64748b;">Tarehe ya Kuanza: ${getTodayFormatted()}<br>Mahali pa Kusaini: Arusha, Tanzania</p>
  </div>

  <div style="margin: 24px 0; padding: 16px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px;">
    <p style="margin: 0; font-weight: 600; color: #92400e;">MKATABA HUU UNA AWAMU MBILI: Kipindi cha majaribio (miezi 3-6) na mkataba wa mwaka mmoja kamili.</p>
  </div>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">UTANGULIZI</h3>
  <p>Kwa kuwa mwajiri anaendesha shughuli za elimu na anahitaji kutoa ajira kwa mwajiriwa,</p>
  <p>Na kwa kuwa mwajiriwa yuko tayari kumhudumia mwajiri kwa masharti yaliyoainishwa kwenye mkataba huu,</p>
  <p>Basi kwa sasa pande zote mbili zimekubaliana kama ifuatavyo:</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">1. AINA YA MKATABA</h3>
  <p><strong>Kipindi cha Majaribio:</strong> Mwajiriwa ana kipindi cha majaribio kinachoweza kuongezwa. Wakati wa kipindi hiki, mwajiriwa atapata faida zote isipokuwa zile za likizo.</p>
  <p><strong>Baada ya Majaribio:</strong> Baada ya mafanikio ya kipindi cha majaribio, mwajiriwa atapewa mkataba wa mwaka mmoja.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">2. MAHALI PA AJIRA</h3>
  <p>Mahali pa ajira ni Arusha, Tanzania, isipokuwa ikibainishwa vinginevyo. Mwajiriwa atafanya kazi Arusha au sehemu nyingine yoyote kama itakavyoelekezwa na mwajiri.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">3. NAFASI YA KAZI</h3>
  <p>Mwajiriwa <strong>${fullName}</strong> atafanya kazi kama <strong>Mpishi</strong>, na atatekeleza majukumu yote yaliyoainishwa au kupewa na mwajiri au msimamizi.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">4. SAA ZA KAZI</h3>
  <p>Ratiba ya kazi ya mwajiriwa itaamuliwa na orodha ya kazi. Ikiwa mwajiriwa atashindwa kuhudhuria kazini kutokana na ugonjwa au ajali, anatakiwa kuwasilisha cheti cha daktari kuthibitisha. Kukosa kufanya hivyo kutaelezwa kuwa kutokuwepo kazini bila ruhusa.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">5. MALIPO</h3>
  <div style="padding: 16px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1)); border-radius: 12px; margin: 16px 0;">
    <p style="margin: 0 0 12px; font-size: 13pt; font-weight: 700; color: #065f46;">Muhtasari wa Mshahara</p>
    <table style="width: 100%; border-collapse: collapse; margin: 0;">
      <tr style="background: rgba(255,255,255,0.7);">
        <td style="padding: 8px; border: 1px solid #d1fae5;"><strong>Mshahara wa Msingi (Jumla)</strong></td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right; font-weight: 700; color: #047857;">TZS ${Number(baseSalary).toLocaleString('sw-TZ')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #d1fae5;">  ? Mshahara (Kazi ya Upishi)</td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right;">TZS ${Number(salary).toLocaleString('sw-TZ')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #d1fae5;">  ? Nyingine (Wajibu Maalum)</td>
        <td style="padding: 8px; border: 1px solid #d1fae5; text-align: right;">TZS ${Number(other).toLocaleString('sw-TZ')}</td>
      </tr>
      <tr style="background: rgba(239, 68, 68, 0.1);">
        <td style="padding: 8px; border: 1px solid #fee2e2;"><strong>Makato ya NSSF (kutoka Mshahara tu)</strong></td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right;"></td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Michango ya Mfanyakazi (10%)</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #dc2626;">- TZS ${Number(nssfEmployee).toLocaleString('sw-TZ')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Michango ya Mwajiri (10%)</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #047857;">+ TZS ${Number(nssfEmployer).toLocaleString('sw-TZ')}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #fee2e2;">  ? Jumla ya NSSF kwa Mwezi</td>
        <td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; font-weight: 700;">TZS ${Number(nssfTotal).toLocaleString('sw-TZ')}</td>
      </tr>
      <tr style="background: rgba(79, 70, 229, 0.15);">
        <td style="padding: 12px; border: 2px solid #4f46e5; font-weight: 700; font-size: 12pt; color: #4f46e5;"><strong>MSHAHARA SAFI (Baada ya NSSF)</strong></td>
        <td style="padding: 12px; border: 2px solid #4f46e5; text-align: right; font-weight: 700; font-size: 12pt; color: #4f46e5;">TZS ${Number(netSalary).toLocaleString('sw-TZ')}</td>
      </tr>
    </table>
  </div>
  <p><strong>Tahadhari ya Kuchelewa Malipo:</strong> Kuna uwezekano wa kucheleweshwa kwa malipo kutokana na utegemezi wa ada za wanafunzi. Hii haimaanishi kwamba malipo hayatalipwa; kuchelewa hakutaondoa jukumu la mwajiriwa kuendelea kufanya kazi.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">6. FAIDA NYINGINE KWA MWAJIRIWA</h3>
  <ol style="padding-left: 20px;">
    <li>Chakula cha kila siku pamoja na chai na chakula cha mchana.</li>
    <li>Mwajiriwa atapewa vifaa vya kazi na atafanyiwa vipimo vya afya mara kwa mara kwa mujibu wa sheria za Tanzania.</li>
  </ol>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">7. LIKIZO</h3>
  <p><strong>Likizo ya Mwaka:</strong> Mwajiriwa ana haki ya siku 28 za likizo ya mwaka baada ya miezi 12 ya kazi mfululizo, itakayochukuliwa mwezi wa Desemba. Likizo haiwezi kuongezwa hadi mwaka unaofuata.</p>
  <p><strong>Likizo ya Ugonjwa:</strong> Mwajiriwa ana haki ya likizo ya ugonjwa ya miezi miwili kwa mshahara kamili, na miezi miwili ya mshahara wa nusu ikiwa ugonjwa utaendelea. Cheti cha daktari kinahitajika.</p>
  <p><strong>Likizo ya Uzazi/Baba:</strong> Mwajiriwa wa kike ana haki ya likizo ya uzazi ya siku 84, na mwajiriwa wa kiume ana haki ya wiki mbili za likizo ya baba. Taarifa kwa mwajiri lazima itolewe mapema pamoja na ripoti ya daktari.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">8. KUVUNJA AJIRA</h3>
  <p><strong>Taarifa ya Kuvunja Ajira:</strong> Pande zote zinaweza kuvunja mkataba kwa kutoa taarifa ya mwezi mmoja au kulipa mshahara wa mwezi mmoja badala ya taarifa hiyo.</p>
  <p><strong>Kujiuzulu:</strong> Mwajiriwa anaweza kujiuzulu kwa kutoa taarifa ya mwezi mmoja au mshahara wa mwezi mmoja badala ya taarifa hiyo.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">9. USIRI NA MALI YA KIWAZO</h3>
  <p>Mwajiriwa anakubali kutotoa siri au kuuza mali yoyote ya kiakili ya shule kwa mtu wa tatu. Kukosa kutii kutapelekea kufukuzwa kazi mara moja na adhabu ya TZS 1,000,000.</p>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">10. KANUNI ZA TABIA NZURI</h3>
  <p>Kukiuka kanuni zifuatazo kunaweza kusababisha kuvunja mkataba au makato ya mshahara:</p>
  <ol style="padding-left: 20px;">
    <li>Kutokuwepo kazini bila ruhusa kwa zaidi ya siku tatu mfululizo.</li>
    <li>Kukataa kutii maelekezo ya mwajiri au msimamizi.</li>
    <li>Utendaji kazi mbovu au kushindwa kufanya kazi kama inavyotakiwa.</li>
  </ol>

  <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">11. SHERIA YA UTAWALA</h3>
  <p>Mkataba huu unatawaliwa na Sheria za Tanzania.</p>

  <div style="margin-top: 48px; page-break-inside: avoid;">
    <h3 style="margin: 24px 0 12px; font-size: 14pt; font-weight: 700; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">12. AHADI YA MWAJIRIWA & SAHIHI</h3>
    <p style="margin-bottom: 32px;">Mimi, <strong>${fullName}</strong>, ninathibitisha kwamba nimeelewa na kukubaliana na masharti ya mkataba huu.</p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px;">
      <div>
        <p style="margin: 0 0 40px;"><strong>Mwajiri (Mkurugenzi):</strong></p>
        <p style="border-top: 2px solid #1e293b; padding-top: 8px; margin: 0;">Sahihi: _______________________</p>
        <p style="margin: 4px 0 0;">Tarehe: ${getTodayFormatted()}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px;"><strong>Mwajiriwa (${fullName}):</strong></p>
        ${signatureUrl ? `<img src="${signatureUrl}" alt="Sahihi" style="max-width: 200px; max-height: 80px; border: 1px solid #e2e8f0; padding: 4px; border-radius: 4px; margin-bottom: 8px;" />` : '<p style="margin: 0 0 40px;"></p>'}
        <p style="border-top: 2px solid #1e293b; padding-top: 8px; margin: 0;">Tarehe: ${getTodayFormatted()}</p>
      </div>
    </div>
  </div>

  <div style="margin-top: 32px; padding: 16px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.05), rgba(124, 58, 237, 0.05)); border-radius: 8px; text-align: center; color: #64748b; font-size: 9pt;">
    <p style="margin: 0;">Mkataba huu umetengenezwa na kuendesha kwa SoMAp · Mfumo wa Usimamizi wa Shule ya Socrates</p>
    <p style="margin: 4px 0 0;">Simu ya Mfanyakazi: ${phone || 'Haipo'} | Tarehe ya Kutengenezwa: ${getTodayFormatted()}</p>
  </div>
</div>
`;

/**
 * Get custom contract template based on role
 */
const getContractTemplate = (role, language) => {
  const normalized = (role || '').toLowerCase();
  
  if (normalized === 'accountant') {
    return language === 'en' ? ACCOUNTANT_TEMPLATE_EN : ACCOUNTANT_TEMPLATE_EN; // TODO: Add Swahili version
  }
  
  if (normalized === 'teacher') {
    return language === 'en' ? TEACHER_TEMPLATE_EN : TEACHER_TEMPLATE_EN; // TODO: Add Swahili version
  }
  
  if (normalized === 'cook' || normalized === 'mpishi') {
    return language === 'sw' ? COOK_TEMPLATE_SW : COOK_TEMPLATE_SW; // TODO: Add English version
  }
  
  // For other roles, return null to use simple template
  return null;
};

export function defaultContractLanguage(role) {
  const lang = CONTRACT_LANGUAGE_BY_ROLE[(role || '').toLowerCase()];
  return lang || 'sw';
}

export function templateKeyForRole(role) {
  return TEMPLATE_BY_ROLE[(role || '').toLowerCase()] || 'general';
}

function roleLabel(role) {
  const labels = {
    driver: 'Driver',
    cook: 'Cook / Mpishi',
    cleaner: 'Cleaner / Msafi',
    guard: 'Security Guard / Mlinzi',
    teacher: 'Teacher / Mwalimu',
    accountant: 'Accountant / Mhasibu',
    manager: 'Manager / Msimamizi',
    academic: 'Academic Staff',
    secretary: 'Secretary / Katibu',
    hr: 'Human Resources',
    storekeeper: 'Storekeeper'
  };
  return labels[(role || '').toLowerCase()] || role || 'Worker';
}

function buildSpecialAgreementHtml(agreement, language) {
  if (!agreement || !agreement.text) return '';
  const lang = agreement.lang === 'sw' ? 'sw' : 'en';
  const heading = lang === 'sw'
    ? 'Makubaliano Maalum'
    : 'Special Agreement';
  const note = lang !== language
    ? (lang === 'sw' ? '(Kiswahili)' : '(English)')
    : '';
  return `
<div style="margin: 24px 0; padding: 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: rgba(79, 70, 229, 0.05);">
  <h3 style="margin: 0 0 8px; font-size: 13pt; color: #4f46e5;">${heading} ${note}</h3>
  <p style="margin: 0; white-space: pre-wrap;">${agreement.text}</p>
</div>`;
}

export function buildContractHtml(profile, { language, signatureUrl = '', terms = null, specialAgreement = null } = {}) {
  const hasTerms = terms && (Number(terms.roleSalary) || Number(terms.responsibilityAllowance));
  const breakdown = calculateSalaryBreakdown(hasTerms ? terms : (profile.baseSalary || 0));
  const role = (profile.role || '').toLowerCase();
  
  const templateData = {
    fullName: profile.fullNameUpper || `${profile.firstName} ${profile.lastName}`.toUpperCase(),
    phone: profile.phone || 'N/A',
    roleLabel: roleLabel(profile.role),
    ...breakdown,
    signatureUrl
  };
  
  const agreementHtml = buildSpecialAgreementHtml(specialAgreement, language);
  // Try to get full contract template
  const customTemplate = getContractTemplate(role, language);
  if (customTemplate) {
    const html = typeof customTemplate === 'function' ? customTemplate(templateData) : customTemplate;
    return agreementHtml ? `${html}${agreementHtml}` : html;
  }
  
  // Fallback to simple template
  const simpleHtml = buildSimpleContractHtml(templateData, language);
  return agreementHtml ? `${simpleHtml}${agreementHtml}` : simpleHtml;
}

function buildSimpleContractHtml({ fullName, roleLabel, baseSalary, salary, other, nssfEmployee, nssfEmployer, nssfTotal, netSalary, signatureUrl }, language) {
  if (language === 'sw') {
    return `
<div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; max-width: 720px; margin: auto; line-height: 1.6; background: white; color: #1e293b;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="width: 80px; height: 80px; margin: 0 auto 16px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 900; color: white;">So</div>
    <h1 style="margin: 0; font-size: 24px; color: #4f46e5;">Mkataba wa Mfanyakazi - SoMAp</h1>
    <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">Makubaliano ya Ajira</p>
  </div>
  <article>
    <p>Mkataba huu ni kati ya <strong>Socrates Pre & Primary School</strong> na <strong>${fullName}</strong> ("Mfanyakazi") kwa kazi ya <strong>${roleLabel}</strong>.</p>
    
    <div style="padding: 16px; background: rgba(79, 70, 229, 0.1); border-radius: 12px; margin: 16px 0;">
      <h3 style="margin: 0 0 12px; color: #4f46e5;">Muhtasari wa Mshahara</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">Mshahara wa Msingi (Jumla)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: 700;">TZS ${Number(baseSalary).toLocaleString('sw-TZ')}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">? Mshahara (Kazi)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right;">TZS ${Number(salary).toLocaleString('sw-TZ')}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">? Nyingine (Wajibu)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right;">TZS ${Number(other).toLocaleString('sw-TZ')}</td></tr>
        <tr style="background: rgba(239, 68, 68, 0.1);"><td style="padding: 8px; border: 1px solid #fee2e2;">NSSF Mfanyakazi (10%)</td><td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #dc2626;">- TZS ${Number(nssfEmployee).toLocaleString('sw-TZ')}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">NSSF Mwajiri (10%)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; color: #047857;">+ TZS ${Number(nssfEmployer).toLocaleString('sw-TZ')}</td></tr>
        <tr style="background: rgba(79, 70, 229, 0.15);"><td style="padding: 12px; border: 2px solid #4f46e5; font-weight: 700; color: #4f46e5;">MSHAHARA SAFI</td><td style="padding: 12px; border: 2px solid #4f46e5; text-align: right; font-weight: 700; color: #4f46e5;">TZS ${Number(netSalary).toLocaleString('sw-TZ')}</td></tr>
      </table>
    </div>

    <h2 style="font-size: 18px; color: #4f46e5; margin-top: 24px;">1. Majukumu</h2>
    <p>Mfanyakazi atahudhuria kazini kabla ya <strong>07:20</strong> (saa za Africa/Nairobi) kila siku ya kazi, kutekeleza majukumu kwa bidii na kuripoti tofauti mara moja.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">2. Mahudhurio</h2>
    <p>Kuchelewa ni kuingia baada ya <strong>07:20</strong>. Kila uchelewaji wa pili, wa nne, wa sita (sawa) ndani ya mwezi utakata <strong>0.001 × mshahara wa msingi</strong>.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">3. Likizo</h2>
    <p>Likizo ya ugonjwa na ya kawaida ni hadi mara tatu (3) kwa siku tisini (90) mfululizo bila ushahidi. Likizo nyingine zinahitaji idhini.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">4. Nidhamu</h2>
    <p>Mfanyakazi atatunza mali za shule, ataepuka wizi, na atazingatia kanuni za SoMAp. Ukiukaji unaweza kusababisha hatua za nidhamu au kusitisha mkataba.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">5. Kukubali</h2>
    <p>Kwa kusaini kidigitali, Mfanyakazi anakubali masharti haya pamoja na kanuni za uchelewaji na makato ya mishahara.</p>
  </article>
  
  <section style="margin-top: 32px; page-break-inside: avoid;">
    ${signatureUrl ? `<div style="margin-bottom: 16px;"><p style="margin: 0 0 8px;"><strong>Sahihi ya Mfanyakazi:</strong></p><img src="${signatureUrl}" alt="Signature" style="max-width: 200px; max-height: 80px; border: 1px solid #e2e8f0; padding: 4px;" /></div>` : '<p>Sahihi ya Mfanyakazi: _____________________________</p>'}
    <p>Tarehe: ${getTodayFormatted()}</p>
  </section>

  <div style="margin-top: 24px; padding: 12px; background: rgba(79, 70, 229, 0.05); border-radius: 8px; text-align: center; color: #64748b; font-size: 10px;">
    <p style="margin: 0;">Mkataba huu umetengenezwa na SoMAp · Socrates Pre & Primary School</p>
  </div>
</div>`;
  }
  
  // English version
  return `
<div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; max-width: 720px; margin: auto; line-height: 1.6; background: white; color: #1e293b;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="width: 80px; height: 80px; margin: 0 auto 16px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 900; color: white;">So</div>
    <h1 style="margin: 0; font-size: 24px; color: #4f46e5;">SoMAp Workers Contract</h1>
    <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">Employment Agreement</p>
  </div>
  <article>
    <p>This employment agreement is entered between <strong>Socrates Pre & Primary School</strong> and <strong>${fullName}</strong> (the "Worker") for the role of <strong>${roleLabel}</strong>.</p>
    
    <div style="padding: 16px; background: rgba(79, 70, 229, 0.1); border-radius: 12px; margin: 16px 0;">
      <h3 style="margin: 0 0 12px; color: #4f46e5;">Salary Breakdown</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">Base Salary (Total)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: 700;">TZS ${Number(baseSalary).toLocaleString('en-US')}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">? Salary (Role)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right;">TZS ${Number(salary).toLocaleString('en-US')}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">? Other (Responsibilities)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right;">TZS ${Number(other).toLocaleString('en-US')}</td></tr>
        <tr style="background: rgba(239, 68, 68, 0.1);"><td style="padding: 8px; border: 1px solid #fee2e2;">NSSF Employee (10%)</td><td style="padding: 8px; border: 1px solid #fee2e2; text-align: right; color: #dc2626;">- TZS ${Number(nssfEmployee).toLocaleString('en-US')}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0;">NSSF Employer (10%)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; color: #047857;">+ TZS ${Number(nssfEmployer).toLocaleString('en-US')}</td></tr>
        <tr style="background: rgba(79, 70, 229, 0.15);"><td style="padding: 12px; border: 2px solid #4f46e5; font-weight: 700; color: #4f46e5;">NET SALARY</td><td style="padding: 12px; border: 2px solid #4f46e5; text-align: right; font-weight: 700; color: #4f46e5;">TZS ${Number(netSalary).toLocaleString('en-US')}</td></tr>
      </table>
    </div>

    <h2 style="font-size: 18px; color: #4f46e5; margin-top: 24px;">1. Term & Duties</h2>
    <p>The Worker shall report daily before <strong>07:20</strong> (Africa/Nairobi). Duties include diligent fulfilment of assigned tasks, reporting variances, and safeguarding school resources.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">2. Working Hours & Attendance</h2>
    <p>Daily attendance is logged via the SoMAp Workers Hub. Late arrival occurs if check-in happens after <strong>07:20</strong>. The second, fourth, sixth (even) lateness in a month incurs a <strong>0.001 × base salary</strong> deduction.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">3. Leave & Benefits</h2>
    <p>Sick and general leave are limited to three (3) requests every rolling ninety (90) days unless proof is provided. Additional leave types follow the SoMAp policy and require approval.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">4. Conduct & Compliance</h2>
    <p>The Worker agrees to maintain integrity, report incidents immediately, and respect school property. Breaches may lead to disciplinary action, penalties, or contract termination.</p>
    
    <h2 style="font-size: 18px; color: #4f46e5;">5. Acceptance</h2>
    <p>By digitally signing below, the Worker acknowledges reading and accepting the terms, including attendance rules and penalty patterns.</p>
  </article>
  
  <section style="margin-top: 32px; page-break-inside: avoid;">
    ${signatureUrl ? `<div style="margin-bottom: 16px;"><p style="margin: 0 0 8px;"><strong>Worker Signature:</strong></p><img src="${signatureUrl}" alt="Signature" style="max-width: 200px; max-height: 80px; border: 1px solid #e2e8f0; padding: 4px;" /></div>` : '<p>Worker Signature: _____________________________</p>'}
    <p>Date: ${getTodayFormatted()}</p>
  </section>

  <div style="margin-top: 24px; padding: 12px; background: rgba(79, 70, 229, 0.05); border-radius: 8px; text-align: center; color: #64748b; font-size: 10px;">
    <p style="margin: 0;">This contract is generated by SoMAp · Socrates Pre & Primary School</p>
  </div>
</div>`;
}

/**
 * FAST acceptance: Just save signature as data URL and mark as accepted
 * PDF generation happens on-demand when user wants to download
 */
export async function quickAcceptContract(workerId, profile, { language, templateKey, signatureFile = null, onProgress = null }) {
  const progress = (step, message) => {
    console.log(`[Contract Accept] ${step}: ${message}`);
    if (onProgress) onProgress(step, message);
  };
  
  // Step 1: Convert signature to data URL (instant, no upload)
  progress('1/2', '?? Inaweka sahihi... | Processing signature...');
  let signatureDataUrl = '';
  if (signatureFile) {
    signatureDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(signatureFile);
    });
  }
  
  // Step 2: Save acceptance to database (instant)
  progress('2/2', '? Inahifadhi... | Saving acceptance...');
  const lang = language || defaultContractLanguage(profile.role);
  
  await getRefs().workerContract(workerId).update({
    language: lang,
    templateKey: templateKey || templateKeyForRole(profile.role),
    accepted: true,
    acceptedTs: localTs(),
    signatureDataUrl: signatureDataUrl,
    contractPdfUrl: '', // Will be generated on-demand
    pdfGenerationStatus: 'pending' // Track PDF generation status
  });

  progress('?', '?? Imekamilika! | Accepted!');
  return { success: true, signatureDataUrl };
}

/**
 * Generate PDF on-demand (when user clicks download)
 * This happens in background and can be slow
 */
export async function generateContractPdf(workerId, profile, { language, signatureDataUrl = '', onProgress = null }) {
  const progress = (step, message) => {
    console.log(`[Contract PDF] ${step}: ${message}`);
    if (onProgress) onProgress(step, message);
  };
  
  // Step 1: Load html2pdf library (if needed)
  progress('1/3', '?? Loading PDF library...');
  await ensureHtml2Pdf();
  
  // Step 2: Generate PDF from HTML
  progress('2/3', '?? Generating PDF...');
  
  const lang = language || defaultContractLanguage(profile.role);
  const html = buildContractHtml(profile, { language: lang, signatureUrl: signatureDataUrl });

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.top = '-9999px';
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  const fileName = `${profile.fullNameUpper || workerId}-contract-${lang}.pdf`;
  
  // Ultra-optimized settings for speed
  const pdfBlob = await window.html2pdf().set({
    margin: 6,
    filename: fileName,
    html2canvas: { 
      scale: 1.2,  // Further reduced for speed
      useCORS: true,
      logging: false,
      removeContainer: true
    },
    jsPDF: { 
      unit: 'mm', 
      format: 'a4', 
      orientation: 'portrait',
      compress: true
    },
    pagebreak: { mode: 'avoid-all' }
  }).from(wrapper).toPdf().output('blob');

  wrapper.remove();

  // Step 3: Upload PDF to Firebase Storage
  progress('3/3', '?? Uploading PDF...');
  
  const storageRef = firebase.storage().ref(`contracts/${workerId}/${fileName}`);
  await storageRef.put(pdfBlob, { contentType: 'application/pdf' });
  const downloadUrl = await storageRef.getDownloadURL();

  // Update contract in database with PDF URL
  await getRefs().workerContract(workerId).update({
    contractPdfUrl: downloadUrl,
    pdfGenerationStatus: 'completed',
    pdfGeneratedTs: localTs()
  });

  progress('?', 'PDF Ready!');
  return downloadUrl;
}

export async function resetContractAcceptance(workerId) {
  await getRefs().workerContract(workerId).update({
    accepted: false,
    acceptedTs: 0,
    contractPdfUrl: '',
    signatureUrl: ''
  });
}


