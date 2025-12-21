export async function fetchInventoryItems(schoolId = '') {
  const db = firebase.database();
  const paths = schoolId
    ? [`schools/${schoolId}/inventory/items`, 'inventory/items']
    : ['inventory/items'];

  for (const path of paths) {
    try {
      const snap = await db.ref(path).once('value');
      if (snap.exists()) {
        return normalizeItems(snap.val());
      }
    } catch (err) {
      console.warn('Failed to load inventory from', path, err);
    }
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
