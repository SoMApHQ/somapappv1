import { dbRefs, localTs, toast } from './workers_helpers.js';
import { uploadFileToStorage } from './workers_ui.js';

let cachedPolicies = null;

async function loadPolicies() {
  if (cachedPolicies) return cachedPolicies;
  // Try multiple paths to be robust across different page locations
  const paths = ['./modules/policies.json', '../modules/policies.json', 'modules/policies.json'];
  let response;
  for (const path of paths) {
    try {
      response = await fetch(path);
      if (response.ok) break;
    } catch (e) {
      console.warn(`Failed to fetch policies from ${path}`, e);
    }
  }
  
  if (!response || !response.ok) {
    console.warn('Could not load policies.json from any path. Using defaults.');
    return {}; // Return empty object instead of crashing to allow app to continue
  }
  cachedPolicies = await response.json();
  return cachedPolicies;
}

export async function createOrUpdateItem(itemId, payload) {
  const ref = itemId ? dbRefs.inventoryItem(itemId) : dbRefs.inventoryItems().push();
  const base = {
    name: payload.name,
    sku: payload.sku,
    unit: payload.unit,
    unitCost: Number(payload.unitCost || 0),
    category: payload.category,
    reorderPoint: Number(payload.reorderPoint || 0),
    onHand: Number(payload.onHand || 0)
  };
  if (!itemId) {
    base.createdTs = localTs();
  } else {
    base.updatedTs = localTs();
  }
  await ref.set(base);
  toast('Inventory item saved', 'success');
  return ref.key;
}

export async function recordReceive({
  itemId,
  qty,
  unitCost,
  supplier,
  invoiceNumber,
  photoFile,
  reason = 'RECEIVE',
  role = 'storekeeper',
  workerUid,
  counterUid
}) {
  if (!itemId || !qty) throw new Error('Item and quantity are required');
  const ledgerRef = dbRefs.inventoryLedger().push();
  let photoUrl = '';
  if (photoFile) {
    const storagePath = `inventory/${itemId}/receipts/${ledgerRef.key}.jpg`;
    photoUrl = await uploadFileToStorage(photoFile, storagePath);
  }
  const ts = localTs();
  await dbRefs.inventoryItem(itemId).child('onHand').transaction(current => (current || 0) + Number(qty));
  await ledgerRef.set({
    ts,
    itemId,
    qty: Number(qty),
    unitCost: Number(unitCost || 0),
    reason,
    role,
    workerUid: workerUid || '',
    counterUid: counterUid || '',
    ref: {
      supplier: supplier || '',
      invoiceNumber: invoiceNumber || ''
    },
    photoUrl
  });
  toast('Stock received and ledger updated', 'success');
  return ledgerRef.key;
}

export async function recordIssue({
  itemId,
  qty,
  reason,
  role,
  workerUid,
  counterUid,
  ref = {},
  photoFile
}) {
  if (!itemId || !qty) throw new Error('Item and quantity are required');
  if (!workerUid || !counterUid) {
    throw new Error('Both worker and storekeeper signatures are required');
  }

  const itemRef = dbRefs.inventoryItem(itemId);
  const ledgerRef = dbRefs.inventoryLedger().push();
  const ts = localTs();

  const newOnHand = await itemRef.child('onHand').transaction(current => {
    const currentVal = current || 0;
    if (currentVal < qty) {
      return current;
    }
    return currentVal - Number(qty);
  });

  if (newOnHand.committed !== true) {
    throw new Error('Insufficient stock on hand');
  }

  let photoUrl = '';
  if (photoFile) {
    const storagePath = `inventory/${itemId}/issues/${ledgerRef.key}.jpg`;
    photoUrl = await uploadFileToStorage(photoFile, storagePath);
  }

  await ledgerRef.set({
    ts,
    itemId,
    qty: -Math.abs(Number(qty)),
    unitCost: 0,
    reason: reason || 'ISSUE',
    role: role || 'storekeeper',
    workerUid,
    counterUid,
    ref,
    photoUrl
  });

  toast('Stock issued and logged', 'info');
  return ledgerRef.key;
}

export async function computeCookProjection({ breakfastPax = 0, lunchPax = 0 }) {
  const policies = await loadPolicies();
  const cookPolicy = policies.consumptionCaps?.cook || {};
  const sugarPer100 = Number(cookPolicy.sugar_kg_per_100_pax_breakfast || 0);
  const oilPer100 = Number(cookPolicy.oil_l_per_100_pax || 0);
  const sugarExpected = (breakfastPax / 100) * sugarPer100;
  const oilExpected = (lunchPax / 100) * oilPer100;
  return {
    sugar_kg: Number(sugarExpected.toFixed(2)),
    oil_l: Number(oilExpected.toFixed(2))
  };
}

export function computeVariance(expected, issued, used) {
  const variance = {};
  Object.keys(expected).forEach(key => {
    const exp = Number(expected[key] || 0);
    const use = Number(used[key] || 0);
    variance[key] = Number((use - exp).toFixed(2));
  });
  const issuedVariance = {};
  Object.keys(issued).forEach(key => {
    const iss = Number(issued[key] || 0);
    const use = Number(used[key] || 0);
    issuedVariance[key] = Number((iss - use).toFixed(2));
  });
  return { variance, issuedVariance };
}

export async function saveCookDailyReport({
  dateKey,
  workerId,
  headcount,
  menu,
  expected,
  issued,
  used,
  photos,
  status = 'pending',
  approverUid = '',
  utensils = {},
  grievance = '',
  penaltyLogged = false
}) {
  if (!dateKey || !workerId) throw new Error('Date and worker required');
  const ref = dbRefs.rolesCookDaily(dateKey).child(workerId);
  await ref.set({
    headcount,
    menu,
    expected,
    issued,
    used,
    variance: computeVariance(expected, issued, used).variance,
    photos,
    status,
    approverUid,
    utensils,
    grievance,
    penaltyLogged,
    updatedTs: localTs()
  });
  toast('Cook report saved', 'success');
}

export async function flagInventoryMismatch({
  dateKey,
  item,
  previousCount,
  newCount,
  explanation,
  workerId
}) {
  const approvalsRef = dbRefs.approvalsQueue().push();
  await approvalsRef.set({
    type: 'inventory-mismatch',
    item,
    previousCount,
    newCount,
    explanation,
    workerId,
    createdTs: localTs(),
    status: 'pending'
  });
  toast('Inventory discrepancy submitted for approval', 'warning');
  return approvalsRef.key;
}

export { loadPolicies };


