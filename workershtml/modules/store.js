import { getYear, scopedOrSocratesLegacy } from './workers_helpers.js';

export async function fetchInventoryItems() {
  const db = firebase.database();
  const scopedPath = `years/${getYear()}/workers_inventory/items`;
  try {
    const snap = await scopedOrSocratesLegacy(db, scopedPath, 'inventory/items');
    if (snap.exists()) {
      return normalizeItems(snap.val());
    }
  } catch (err) {
    console.warn('Failed to load inventory', err);
  }
  return [];
}

function normalizeItems(raw = {}) {
  return Object.entries(raw).map(([id, item]) => ({
    id,
    name: item.name || item.title || item.sku || 'Kitu',
    unit: item.unit || item.measure || '',
    onHand: Number(item.onHand || item.qty || 0),
    category: item.category || '',
    sku: item.sku || ''
  })).sort((a, b) => a.name.localeCompare(b.name));
}
