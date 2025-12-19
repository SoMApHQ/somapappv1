(function () {
  const SharedState = {
    mode: "guest",
    uid: null,
    currentCashbookId: "default",
    cashbooks: {},
    potsByCashbook: {},
    transactionsByCashbook: {},
    budgetsByCashbook: {},
    settings: {
      currency: "TZS",
      defaultCashbookId: "default",
      lastOpenedCashbookId: "default"
    },
    sharedConfig: {
      enabled: true,
      sharedWithName: "Mwenza",
      sharedNote: "Kitabu cha pamoja"
    }
  };

  document.addEventListener("DOMContentLoaded", initShared);

  async function initShared() {
    await hydrateShared();
    ensureSharedExists();
    renderSharedConfig();
    bindSharedHandlers();
  }

  async function hydrateShared() {
    const user = window.firebase?.auth?.().currentUser || null;
    if (user) {
      SharedState.mode = "firebase";
      SharedState.uid = user.uid;
      const snap = await firebase.database().ref("society/" + user.uid).once("value");
      const data = snap.val() || {};
      const cashbooks = data.cashbooks || {};
      SharedState.cashbooks = {};
      SharedState.potsByCashbook = {};
      SharedState.transactionsByCashbook = {};
      SharedState.budgetsByCashbook = {};
      Object.keys(cashbooks).forEach((cbId) => {
        const cb = cashbooks[cbId];
        SharedState.cashbooks[cbId] = cb.meta || { id: cbId, name: cbId, currency: SharedState.settings.currency };
        SharedState.potsByCashbook[cbId] = cb.pots || {};
        SharedState.transactionsByCashbook[cbId] = cb.transactions || {};
        SharedState.budgetsByCashbook[cbId] = cb.budgets || {};
      });
      SharedState.settings = { ...SharedState.settings, ...(data.settings || {}) };
      SharedState.sharedConfig = cashbooks.shared?.sharedConfig || SharedState.sharedConfig;
      SharedState.currentCashbookId = SharedState.settings.lastOpenedCashbookId || "default";
    } else {
      const raw = localStorage.getItem("society_money_memory_v1");
      if (raw) {
        try {
          const data = JSON.parse(raw);
          SharedState.cashbooks = data.cashbooks || {};
          SharedState.potsByCashbook = data.potsByCashbook || {};
          SharedState.transactionsByCashbook = data.transactionsByCashbook || {};
          SharedState.budgetsByCashbook = data.budgetsByCashbook || {};
          SharedState.settings = { ...SharedState.settings, ...(data.settings || {}) };
          SharedState.currentCashbookId = data.currentCashbookId || "default";
        } catch (e) {
          console.warn("Failed to parse local shared data", e);
        }
      }
    }
  }

  function ensureSharedExists() {
    if (!SharedState.cashbooks["shared"]) {
      SharedState.cashbooks["shared"] = {
        id: "shared",
        name: "Shared",
        emoji: "🤝",
        color: "#2563eb",
        startingBalance: 0,
        currency: SharedState.settings.currency,
        type: "shared",
        archived: false,
        createdAt: new Date().toISOString()
      };
    }
    if (!SharedState.potsByCashbook["shared"]) {
      SharedState.potsByCashbook["shared"] = {
        familia: { id: "familia", name: "Familia", emoji: "🏠" },
        shule: { id: "shule", name: "Shule", emoji: "🏫" },
        gari: { id: "gari", name: "Gari", emoji: "🚗" },
        akiba: { id: "akiba", name: "Akiba", emoji: "💰" }
      };
    }
    persistShared();
  }

  function bindSharedHandlers() {
    document.getElementById("open-shared")?.addEventListener("click", () => switchBook("shared"));
    document.getElementById("open-default")?.addEventListener("click", () => switchBook(SharedState.settings.defaultCashbookId || "default"));
    document.getElementById("switch-default")?.addEventListener("click", () => switchBook(SharedState.settings.defaultCashbookId || "default"));
    document.getElementById("switch-shared")?.addEventListener("click", () => switchBook("shared"));
  }

  function switchBook(id) {
    SharedState.currentCashbookId = id;
    SharedState.settings.lastOpenedCashbookId = id;
    persistShared();
    window.location.href = "societycashbook.html";
  }

  function renderSharedConfig() {
    const holder = document.getElementById("shared-config");
    if (!holder) return;
    holder.innerHTML = `
      <div>Imewashwa: ${SharedState.sharedConfig.enabled ? "Ndiyo" : "Hapana"}</div>
      <div>Unashirikiana na: ${SharedState.sharedConfig.sharedWithName || "-"}</div>
      <div>Maelezo: ${SharedState.sharedConfig.sharedNote || "-"}</div>
    `;
  }

  function persistShared() {
    if (SharedState.mode === "firebase" && SharedState.uid) {
      const updates = {};
      updates[`society/${SharedState.uid}/cashbooks`] = mergeCashbooks();
      updates[`society/${SharedState.uid}/settings/lastOpenedCashbookId`] = SharedState.settings.lastOpenedCashbookId;
      updates[`society/${SharedState.uid}/settings/defaultCashbookId`] = SharedState.settings.defaultCashbookId || "default";
      firebase.database().ref().update(updates);
    } else {
      const snapshot = {
        mode: SharedState.mode,
        currentCashbookId: SharedState.currentCashbookId,
        cashbooks: SharedState.cashbooks,
        potsByCashbook: SharedState.potsByCashbook,
        transactionsByCashbook: SharedState.transactionsByCashbook,
        budgetsByCashbook: SharedState.budgetsByCashbook,
        settings: SharedState.settings
      };
      localStorage.setItem("society_money_memory_v1", JSON.stringify(snapshot));
    }
  }

  function mergeCashbooks() {
    const merged = {};
    Object.keys(SharedState.cashbooks).forEach((id) => {
      merged[id] = {
        meta: SharedState.cashbooks[id],
        pots: SharedState.potsByCashbook[id] || {},
        transactions: SharedState.transactionsByCashbook[id] || {},
        budgets: SharedState.budgetsByCashbook[id] || {},
        sharedConfig: id === "shared" ? SharedState.sharedConfig : undefined
      };
    });
    return merged;
  }
})();
