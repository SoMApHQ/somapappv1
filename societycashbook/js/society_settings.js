const SettingsState = {
  mode: "guest",
  uid: null,
  cashbooks: {},
  settings: {
    language: "sw",
    currency: "TZS",
    timezone: "Africa/Nairobi",
    startOfWeek: "monday",
    defaultCashbookId: "default",
    lastOpenedCashbookId: "default"
  }
};

document.addEventListener("DOMContentLoaded", initSettings);

async function initSettings() {
  await hydrateSettings();
  populateCashbookOptions();
  fillSettingsForm();
  bindSettingsHandlers();
}

async function hydrateSettings() {
  const user = window.firebase?.auth?.().currentUser || null;
  if (user) {
    SettingsState.mode = "firebase";
    SettingsState.uid = user.uid;
    const snap = await firebase.database().ref("society/" + user.uid).once("value");
    const data = snap.val() || {};
    const cashbooks = data.cashbooks || {};
    SettingsState.cashbooks = {};
    Object.keys(cashbooks).forEach((cbId) => {
      const cb = cashbooks[cbId];
      SettingsState.cashbooks[cbId] = cb.meta || { id: cbId, name: cbId };
    });
    SettingsState.settings = { ...SettingsState.settings, ...(data.settings || {}) };
  } else {
    const raw = localStorage.getItem("society_money_memory_v1");
    if (raw) {
      try {
        const data = JSON.parse(raw);
        SettingsState.cashbooks = data.cashbooks || {};
        SettingsState.settings = { ...SettingsState.settings, ...(data.settings || {}) };
      } catch (e) {
        console.warn("Failed to read settings cache", e);
      }
    }
  }
  if (!SettingsState.cashbooks["default"]) {
    SettingsState.cashbooks["default"] = { id: "default", name: "Familia" };
  }
}

function populateCashbookOptions() {
  const sel = document.getElementById("settings-default-cb");
  if (!sel) return;
  sel.innerHTML = "";
  Object.values(SettingsState.cashbooks).forEach((cb) => {
    const opt = document.createElement("option");
    opt.value = cb.id;
    opt.textContent = `${cb.emoji || "📒"} ${cb.name}`;
    if (cb.id === SettingsState.settings.defaultCashbookId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function fillSettingsForm() {
  document.getElementById("settings-language").value = SettingsState.settings.language || "sw";
  document.getElementById("settings-currency").value = SettingsState.settings.currency || "TZS";
  document.getElementById("settings-week").value = SettingsState.settings.startOfWeek || "monday";
  document.getElementById("settings-default-cb").value = SettingsState.settings.defaultCashbookId || "default";
}

function bindSettingsHandlers() {
  document.getElementById("settings-save")?.addEventListener("click", saveSettings);
  document.getElementById("settings-reset")?.addEventListener("click", () => {
    localStorage.removeItem("society_money_memory_v1");
    alert("Data ya guest imefutwa.");
  });
}

function saveSettings() {
  SettingsState.settings.language = document.getElementById("settings-language").value;
  SettingsState.settings.currency = document.getElementById("settings-currency").value;
  SettingsState.settings.startOfWeek = document.getElementById("settings-week").value;
  SettingsState.settings.defaultCashbookId = document.getElementById("settings-default-cb").value;
  SettingsState.settings.lastOpenedCashbookId = SettingsState.settings.defaultCashbookId;
  if (SettingsState.mode === "firebase" && SettingsState.uid) {
    firebase
      .database()
      .ref(`society/${SettingsState.uid}/settings`)
      .set(SettingsState.settings);
  } else {
    const raw = localStorage.getItem("society_money_memory_v1");
    let snapshot = {};
    try {
      snapshot = raw ? JSON.parse(raw) : {};
    } catch (e) {
      snapshot = {};
    }
    snapshot.settings = SettingsState.settings;
    snapshot.cashbooks = SettingsState.cashbooks;
    snapshot.currentCashbookId = SettingsState.settings.defaultCashbookId;
    localStorage.setItem("society_money_memory_v1", JSON.stringify(snapshot));
  }
  alert("Mipangilio imehifadhiwa.");
}
