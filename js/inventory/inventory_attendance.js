// SoMAp Daily Inventory — hooks used by workersattendance.html.
// Added on top of every existing attendance rule (never instead of one):
//   check-in   one extra reminder line, plus a shift-handover prompt for guards
//   check-out  today's inventory must be submitted (a returned report counts as not submitted);
//              the Head Teacher must also review today's reports (approval by exception)
// Any internal error lets check-out continue (logged), so the module can never lock workers out.
(function (global) {
  'use strict';
  const INV = global.SomapInventory;
  const UI = global.SomapInventoryUI;
  if (!INV || !UI) { console.warn('SomapInventoryAttendance: core/ui scripts missing'); return; }
  const { esc, todayYMD, fmtTime } = INV.util;

  async function contextFor(info) {
    return INV.resolveContext({
      schoolId: info.schoolId, schoolName: info.schoolName, workerId: info.workerId, profile: info.profile || undefined,
      teacherConfig: info.teacherConfig || undefined, ymd: info.ymd || todayYMD(), detectAdmin: false,
    });
  }
  async function enabledContext(info) {
    const ctx = await contextFor(info);
    const settings = await INV.loadSettings(ctx, ctx.year);
    return { ctx, settings, enabled: INV.isEnabledFor(settings, ctx.workerId) };
  }
  const fillUrl = () => `${INV.URLS.inventory}?return=checkout`;

  // Page load: reminder line in the check-in rules box and the "saved" banner after returning.
  async function initPage() {
    const params = new URLSearchParams(global.location.search || '');
    if (params.get('inventory') === 'saved') {
      UI.toast('Hesabu imehifadhiwa. Sasa unaweza kuondoka · Inventory saved. You can now check out.', 'success', 8000);
      try {
        params.delete('inventory');
        const url = new URL(global.location.href); url.search = params.toString();
        global.history.replaceState(global.history.state, '', url.toString());
      } catch (_) { /* ignore */ }
      const btn = global.document.getElementById('checkOutBtn');
      if (btn) { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); btn.style.boxShadow = '0 0 0 4px rgba(21,128,61,0.45)'; setTimeout(() => { btn.style.boxShadow = ''; }, 6000); }
    }
    const line = global.document.getElementById('somapInventoryReminder');
    if (!line) return;
    try {
      const { enabled } = await enabledContext({});
      line.hidden = !enabled;
    } catch (err) { console.warn('Inventory reminder skipped', err); }
  }

  async function runCheckoutGate(info) {
    try {
      const { ctx, enabled } = await enabledContext(info);
      if (!enabled) return { ok: true };
      const st = await INV.todayStatus(ctx, ctx.workerId, ctx.ymd);
      if (!st.done) {
        const returned = st.status === 'returned';
        const go = await UI.modal({
          title: 'Hujajaza hesabu ya mali ya leo',
          html: `<div class="inv-scope"><p><b>You have not filled today's inventory.</b> Huwezi kuondoka bila kutuambia ulichoacha kwenye dhamana yako · You cannot check out before reporting what you are leaving in your docket.</p>
            ${returned ? `<div class="inv-banner inv-banner--bad"><span class="inv-banner__icon">↩️</span><div class="inv-banner__body"><strong>Ripoti imerudishwa · Report returned</strong>"${esc(st.returnComment)}"</div></div>` : ''}
            <p class="inv-card__sub">Ukihifadhi, utarudishwa hapa kubonyeza Check-Out · After saving you come back here to check out.</p></div>`,
          actions: [{ label: 'Baadaye · Later', value: false }, { label: 'Jaza sasa · Fill now', value: true, kind: 'primary' }],
        });
        if (go) global.location.href = fillUrl();
        return { ok: false, message: returned ? 'Ripoti ya hesabu imerudishwa. Rekebisha na uwasilishe kabla ya check-out.' : 'Jaza hesabu ya mali ya leo kabla ya check-out · Fill today\'s inventory before check-out.' };
      }
      if (ctx.isHeadteacher && typeof global.SomapInventoryAttendance.headteacherGate === 'function') {
        return await global.SomapInventoryAttendance.headteacherGate(ctx);
      }
      return { ok: true };
    } catch (err) {
      console.warn('Inventory checkout gate skipped', err);
      return { ok: true };
    }
  }

  async function afterCheckin(info) {
    try {
      const { ctx, enabled } = await enabledContext(info);
      if (!enabled) return;
      UI.toast('Kumbuka: jaza hesabu ya mali (inventory) kabla ya kuondoka leo · Remember to fill your inventory before checking out today.', 'info', 7000);
      if (ctx.roleKey !== 'guard') return;
      const docket = await INV.loadDocket(ctx, ctx.workerId, ctx.year, { roleKey: ctx.roleKey, profile: ctx.profile });
      const pending = await INV.pendingShiftHandover(ctx, docket);
      if (!pending) return;
      const go = await UI.modal({
        title: 'Makabidhiano ya zamu · Shift handover',
        html: `<p>${esc(pending.from.workerName || '')} aliwasilisha hesabu ya ${esc(pending.from.area || '')} saa ${fmtTime(pending.from.submittedAt)}. Thibitisha "Nimepokea" au andika tofauti · Confirm you received it or record differences.</p>`,
        actions: [{ label: 'Baadaye · Later', value: false }, { label: 'Pokea sasa · Receive now', value: true, kind: 'primary' }],
      });
      if (go) global.location.href = INV.URLS.inventory;
    } catch (err) { console.warn('Inventory check-in hook skipped', err); }
  }

  async function afterCheckout(info) {
    try {
      if (typeof global.SomapInventoryAttendance.headteacherAfterCheckout !== 'function') return;
      const { ctx, enabled } = await enabledContext(info);
      if (!enabled || !ctx.isHeadteacher) return;
      await global.SomapInventoryAttendance.headteacherAfterCheckout(ctx);
    } catch (err) { console.warn('Inventory after-checkout hook skipped', err); }
  }

  global.SomapInventoryAttendance = Object.assign(global.SomapInventoryAttendance || {}, { initPage, runCheckoutGate, afterCheckin, afterCheckout });
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => initPage()); else initPage();
})(window);
