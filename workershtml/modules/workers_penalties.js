import { dbRefs, localTs, yyyymm, toast } from './workers_helpers.js';

const DEFAULT_RULE_PERCENT = 0.001;
const getRefs = () => dbRefs(firebase.database());

export async function applyPenalty({
  workerId,
  kind,
  baseSalary,
  refPath,
  rulePercent = DEFAULT_RULE_PERCENT,
  metadata = {},
  forceCharge = false
}) {
  if (!workerId || !kind) {
    throw new Error('workerId and kind are required');
  }
  const monthKey = yyyymm(new Date());
  const ledgerRef = getRefs().penaltiesLedgerMonth(workerId, monthKey);
  const snapshot = await ledgerRef.once('value');

  let occurrence = 1;
  if (snapshot.exists()) {
    const entries = snapshot.val();
    occurrence =
      Object.values(entries).filter(entry => entry.kind === kind).length + 1;
  }

  const shouldCharge = forceCharge || (rulePercent > 0 && occurrence % 2 === 0);
  const amount = shouldCharge ? Math.round(Number(baseSalary || 0) * Number(rulePercent)) : 0;

  const entryRef = ledgerRef.push();
  const payload = {
    kind,
    occurrence,
    rulePercent: Number(rulePercent),
    amountTZS: amount,
    baseSalaryAtTime: Number(baseSalary || 0),
    refPath: refPath || '',
    createdTs: localTs(),
    approved: true,
    ...metadata
  };

  await entryRef.set(payload);

  if (shouldCharge) {
    toast(`Penalty recorded for ${kind} (amount ${amount} TZS)`, 'warning');
  } else {
    toast(`Occurrence ${occurrence} for ${kind} logged (no deduction this time)`, 'info');
  }
  return { occurrence, amount, ref: entryRef.key };
}

export async function listMonthlyPenalties(workerId, monthKey) {
  const snap = await getRefs().penaltiesLedgerMonth(workerId, monthKey).once('value');
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([key, value]) => ({ id: key, ...value }));
}


