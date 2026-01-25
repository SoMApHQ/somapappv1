import { getYear, scopedOrSocratesLegacy } from './workers_helpers.js';

function roundValue(value, rounding) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  if (rounding === 'ceil') return Math.ceil(n * 100) / 100;
  if (rounding === 'round') return Math.round(n * 100) / 100;
  return Math.floor(n * 100) / 100;
}

export async function loadLogicRules() {
  const db = firebase.database();
  const scopedPath = `years/${getYear()}/kitchen_logic/rules`;
  try {
    const snap = await scopedOrSocratesLegacy(db, scopedPath, 'kitchen_logic/rules');
    if (snap.exists()) return snap.val() || {};
  } catch (err) {
    console.warn('Failed to load kitchen logic rules', err);
  }
  return {};
}

export function computeExpectedList({ pax = 0, selections = [], rules = {}, meal, inventoryItems = [] }) {
  const selected = selections || [];
  const result = [];
  selected.forEach(itemId => {
    const rule = rules[itemId];
    if (!rule) return;
    if (rule.perMeal && rule.perMeal !== 'both' && rule.perMeal !== meal) return;
    const perChild = Number(rule.perChild || rule.per_student || 0);
    const expectedQty = roundValue(pax * perChild, rule.rounding || 'round');
    const itemMeta = inventoryItems.find(it => it.id === itemId) || {};
    result.push({
      itemId,
      name: itemMeta.name || rule.name || itemId,
      unit: rule.unit || itemMeta.unit || '',
      expectedQty,
      meal: meal || rule.perMeal || 'both'
    });
  });
  return result;
}

export function aggregateExpected(list = []) {
  const acc = {};
  list.forEach(item => {
    const key = item.itemId;
    if (!acc[key]) {
      acc[key] = { ...item };
    } else {
      acc[key].expectedQty += Number(item.expectedQty || 0);
      acc[key].expectedQty = roundValue(acc[key].expectedQty, 'round');
    }
  });
  return Object.values(acc);
}
