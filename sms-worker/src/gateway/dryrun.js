// Dry-run gateway: sends NOTHING. It answers exactly like a real gateway would,
// using our own part count, so the whole pipeline (wallet, ledger, history)
// can be tested safely.
import core from '../../../shared/sms_core.js';

export function createDryRunGateway() {
  return {
    name: 'dryrun',
    async sendBulk({ items }) {
      const results = new Map();
      items.forEach((i, n) => {
        results.set(i.msisdn, { status: 'dryrun', uid: `dry-${Date.now().toString(36)}-${n}`, units: core.countSmsParts(i.text).parts });
      });
      return { accepted: true, results, failures: new Map(), campaignUid: null, totalUnits: null, replay: false, mode: 'dryrun' };
    },
    async sendOne({ text }) {
      return { accepted: true, uid: `dry-${Date.now().toString(36)}`, status: 'dryrun', units: core.countSmsParts(text).parts, mode: 'dryrun' };
    },
    async balance() { return { ok: true, data: { balance: null, note: 'dry-run' } }; },
    async senderIds() { return { ok: true, data: [] }; },
    async message(uid) { return { ok: true, data: { uid, status: 'dryrun' } }; },
  };
}
