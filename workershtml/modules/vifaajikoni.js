import { localTs, toast } from './workers_helpers.js';

const BASELINE_ITEMS = [
  { id: 'plates', name: 'Sahani', unit: 'pcs', category: 'utensil' },
  { id: 'cups', name: 'Vikombe', unit: 'pcs', category: 'utensil' },
  { id: 'spoons', name: 'Vijiko', unit: 'pcs', category: 'utensil' },
  { id: 'knives', name: 'Visu', unit: 'pcs', category: 'utensil' },
  { id: 'sufuria', name: 'Sufuria', unit: 'pcs', category: 'cookware' },
  { id: 'basins', name: 'Beseni', unit: 'pcs', category: 'equipment' },
  { id: 'buckets', name: 'Ndoo', unit: 'pcs', category: 'equipment' },
  { id: 'thermos', name: 'Thermos', unit: 'pcs', category: 'equipment' },
  { id: 'tables', name: 'Meza (Jikoni)', unit: 'pcs', category: 'furniture' },
  { id: 'stoves', name: 'Jiko / Stove', unit: 'pcs', category: 'equipment' },
  { id: 'others', name: 'Vingine (ongeza)', unit: 'pcs', category: 'other' }
];

export function resolveYearKey(yearLike) {
  const raw = String(yearLike || '').trim();
  const match = raw.match(/\d{4}/);
  if (match) return match[0];
  return String(new Date().getFullYear());
}

export function kitchenBasePath({ schoolId, yearLike }) {
  const yearKey = resolveYearKey(yearLike);
  if (schoolId) return `schools/${schoolId}/kitchen_inventory/${yearKey}`;
  return `kitchen_inventory/${yearKey}`;
}

export async function ensureKitchenSeeded({ schoolId, yearLike }) {
  const base = kitchenBasePath({ schoolId, yearLike });
  const metaRef = firebase.database().ref(`${base}/meta/seeded`);
  const metaSnap = await metaRef.once('value');
  if (metaSnap.exists() && metaSnap.val() === true) return;

  const itemsRef = firebase.database().ref(`${base}/items`);
  const itemsSnap = await itemsRef.once('value');
  if (itemsSnap.exists()) {
    await metaRef.set(true);
    return;
  }

  const now = localTs();
  const updates = {};
  BASELINE_ITEMS.forEach(item => {
    updates[item.id] = {
      id: item.id,
      name: item.name,
      unit: item.unit || 'pcs',
      category: item.category || '',
      qtyTotal: 0,
      sourceType: '',     // 'purchased' | 'donated' | 'school' | ''
      sourceName: '',
      unitPrice: 0,
      acquiredDate: '',
      note: '',
      active: true,
      createdTs: now,
      updatedTs: now
    };
  });

  await itemsRef.update(updates);
  await metaRef.set(true);
}

export async function listKitchenItems({ schoolId, yearLike }) {
  const base = kitchenBasePath({ schoolId, yearLike });
  const snap = await firebase.database().ref(`${base}/items`).once('value');
  const raw = snap.val() || {};
  const items = Object.values(raw).filter(Boolean);
  items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return items;
}

export async function upsertKitchenItem({ schoolId, yearLike, item }) {
  const base = kitchenBasePath({ schoolId, yearLike });
  const id = item.id || firebase.database().ref(`${base}/items`).push().key;
  const now = localTs();

  const payload = {
    id,
    name: String(item.name || '').trim(),
    unit: String(item.unit || 'pcs').trim(),
    category: String(item.category || '').trim(),
    qtyTotal: Number(item.qtyTotal || 0),
    sourceType: String(item.sourceType || '').trim(),
    sourceName: String(item.sourceName || '').trim(),
    unitPrice: Number(item.unitPrice || 0),
    acquiredDate: String(item.acquiredDate || '').trim(),
    note: String(item.note || '').trim(),
    active: item.active !== false,
    updatedTs: now,
    createdTs: item.createdTs || now
  };

  if (!payload.name) throw new Error('Jina la kifaa linahitajika.');

  await firebase.database().ref(`${base}/items/${id}`).set(payload);
  toast('Kifaa kimehifadhiwa.', 'success');
  return id;
}

export async function archiveKitchenItem({ schoolId, yearLike, itemId }) {
  const base = kitchenBasePath({ schoolId, yearLike });
  await firebase.database().ref(`${base}/items/${itemId}/active`).set(false);
  await firebase.database().ref(`${base}/items/${itemId}/updatedTs`).set(localTs());
  toast('Kifaa kimehifadhiwa kama “si-active”.', 'info');
}

export function buildDefaultDailyFromItems(items) {
  const out = {};
  (items || []).forEach(item => {
    out[item.id] = {
      available: '',
      destroyed: '',
      lost: '',
      misplaced: '',
      location: '',
      note: ''
    };
  });
  return out;
}

export function mergeDailyWithItems(existingDaily, items) {
  const base = buildDefaultDailyFromItems(items);
  const merged = { ...base };
  Object.entries(existingDaily || {}).forEach(([id, node]) => {
    merged[id] = {
      ...merged[id],
      available: node?.available ?? merged[id].available,
      destroyed: node?.destroyed ?? merged[id].destroyed,
      lost: node?.lost ?? merged[id].lost,
      misplaced: node?.misplaced ?? merged[id].misplaced,
      location: node?.location ?? merged[id].location,
      note: node?.note ?? merged[id].note
    };
  });
  return merged;
}

export function detectDailyChanges(todayDaily, yesterdayDaily) {
  const changedIds = [];
  const missingLocationIds = [];

  Object.keys(todayDaily || {}).forEach(id => {
    const t = todayDaily[id] || {};
    const y = (yesterdayDaily || {})[id] || {};
    const changed =
      Number(y.available || 0) !== Number(t.available || 0) ||
      Number(y.destroyed || 0) !== Number(t.destroyed || 0) ||
      Number(y.lost || 0) !== Number(t.lost || 0) ||
      Number(y.misplaced || 0) !== Number(t.misplaced || 0);

    if (changed) {
      changedIds.push(id);
      const loc = String(t.location || '').trim();
      if (!loc) missingLocationIds.push(id);
    }
  });

  return { changedIds, missingLocationIds };
}

