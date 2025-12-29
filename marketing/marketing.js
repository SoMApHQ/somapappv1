
// marketing/marketing.js
// MarketingHub: multi-soko marketplace (React CDN + Firebase RTDB, no build step).

const STYLE_URL = new URL("./marketing.css", import.meta.url).href;
const REACT_URL = "https://unpkg.com/react@18/umd/react.production.min.js";
const REACT_DOM_URL =
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";

const isBrowser = typeof window !== "undefined";

// Default categories to seed when empty (admin only).
const DEFAULT_CATEGORIES = [
  {
    id: "vehicle_spares",
    nameSw: "Soko la Vifaa vya Magari",
    nameEn: "Vehicle Spares",
    icon: "CAR-SPARES",
    order: 1,
  },
  { id: "cars", nameSw: "Soko la Magari", nameEn: "Cars", icon: "CARS", order: 2 },
  { id: "land", nameSw: "Soko la Mashamba", nameEn: "Land", icon: "LAND", order: 3 },
  { id: "houses", nameSw: "Soko la Nyumba", nameEn: "Houses", icon: "HOUSES", order: 4 },
  {
    id: "rentals",
    nameSw: "Soko la Kupanga Nyumba",
    nameEn: "Rentals",
    icon: "RENTALS",
    order: 5,
  },
  { id: "utensils", nameSw: "Soko la Vyombo", nameEn: "Utensils", icon: "UTENSILS", order: 6 },
  {
    id: "electronics",
    nameSw: "Vifaa vya Elektroniki",
    nameEn: "Electronics & Gadgets",
    icon: "ELECTRONICS",
    order: 7,
  },
  {
    id: "uniforms",
    nameSw: "Uniformu na Mahitaji ya Shule",
    nameEn: "Uniforms & School Supplies",
    icon: "UNIFORMS",
    order: 8,
  },
];

function loadScriptOnce(src, globalKey) {
  if (!isBrowser) return Promise.resolve();
  if (globalKey && window[globalKey]) return Promise.resolve();
  const existing = document.querySelector(`script[data-src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensureReact() {
  return loadScriptOnce(REACT_URL, "React").then(() =>
    loadScriptOnce(REACT_DOM_URL, "ReactDOM")
  );
}

function ensureStyle() {
  if (!isBrowser) return;
  const existing = document.querySelector(`link[data-mh-style="marketing"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.mhStyle = "marketing";
  document.head.appendChild(link);
}

function createRootCompat(el) {
  if (window.ReactDOM && typeof ReactDOM.createRoot === "function") {
    return ReactDOM.createRoot(el);
  }
  return {
    render: (node) => ReactDOM.render(node, el),
  };
}

function useFirebase() {
  const hasFb =
    isBrowser && window.firebase && firebase.apps && firebase.apps.length > 0;
  const db = hasFb ? firebase.database() : null;
  const auth = hasFb && firebase.auth ? firebase.auth() : null;
  return { hasFb, db, auth };
}

function ensureAnonAuth(auth) {
  if (!auth) return Promise.resolve(null);
  const user = auth.currentUser;
  if (user) return Promise.resolve(user);
  return auth.signInAnonymously().then((cred) => cred.user);
}

function normalizePhoneDigits(input = "") {
  return (input.match(/\d+/g) || []).join("");
}

function loginToEmail(login = "") {
  const trimmed = (login || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = normalizePhoneDigits(trimmed);
  return digits ? `${digits}@somap-seller.com` : "";
}

function shopMatchesCategory(shop, catId) {
  if (!catId || !shop) return false;
  if (shop.categories && typeof shop.categories === "object") {
    return Boolean(shop.categories[catId]);
  }
  if (Array.isArray(shop.categories)) {
    return shop.categories.includes(catId);
  }
  return false;
}

function unique(array) {
  return Array.from(new Set(array.filter(Boolean)));
}

function formatCurrency(val, currency = "TZS") {
  if (val === undefined || val === null || val === "") return "";
  const num = Number(val);
  if (Number.isNaN(num)) return "";
  return `${currency} ${num.toLocaleString()}`;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString();
}

function heroWhatsAppLink(shop, itemTitle) {
  const phone = shop?.whatsappPhone || shop?.phones?.[0] || "";
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const msg = `Hi ${shop?.ownerName || shop?.shopName || "seller"}, I am interested in ${itemTitle || "your items"}.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}

function MarketingCard({ onClick }) {
  return React.createElement(
    "div",
    { className: "mh-card-shell" },
    React.createElement(
      "div",
      { className: "mh-card-body" },
      React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "mh-chip" },
          "MarketingHub",
          React.createElement("span", { className: "mh-pill" }, "Soko Huru")
        ),
        React.createElement(
          "div",
          { className: "mh-title" },
          "Wezesha masoko yote"
        ),
        React.createElement(
          "p",
          { className: "mh-sub" },
          "Stat cards za kila soko. Bonyeza uingie moja kwa moja."
        )
      ),
      React.createElement("button", { className: "mh-cta", onClick }, "Fungua")
    )
  );
}

function StatCard({ cat, stats, onClick }) {
  return React.createElement(
    "button",
    { className: "mh-stat-card", onClick },
    React.createElement(
      "div",
      { className: "mh-stat-top" },
      React.createElement("span", { className: "mh-stat-icon" }, cat.icon || "SOKO"),
      React.createElement("span", { className: "mh-badge" }, cat.enabled === false ? "Disabled" : "Live")
    ),
    React.createElement("div", { className: "mh-stat-name" }, cat.nameSw || cat.nameEn),
    React.createElement(
      "div",
      { className: "mh-stat-metrics" },
      React.createElement(
        "span",
        { className: "mh-stat-metric" },
        React.createElement("strong", null, stats.shops || 0),
        " Shops"
      ),
      React.createElement(
        "span",
        { className: "mh-stat-metric" },
        React.createElement("strong", null, stats.items || 0),
        " Items"
      ),
      React.createElement(
        "span",
        { className: "mh-stat-metric" },
        React.createElement("strong", null, stats.locations || 0),
        " Locations"
      )
    )
  );
}
function ShopCard({ shop, items, onOpen }) {
  const sampleItems = (items || []).slice(0, 3);
  const wa = heroWhatsAppLink(shop);
  return React.createElement(
    "div",
    { className: "mh-shop-card" },
    React.createElement(
      "div",
      { className: "mh-shop-head" },
      React.createElement(
        "div",
        null,
        React.createElement("h3", null, shop.shopName || "Shop"),
        React.createElement(
          "p",
          { className: "mh-muted" },
          [shop.region, shop.city, shop.area].filter(Boolean).join(" - ")
        )
      ),
      shop.verifiedStatus === "verified"
        ? React.createElement("span", { className: "mh-badge" }, "Verified")
        : null
    ),
    React.createElement(
      "div",
      { className: "mh-shop-items" },
      sampleItems.map((item) =>
        React.createElement(
          "div",
          { key: item.id, className: "mh-chip" },
          `${item.title} @ ${formatCurrency(item.price, item.currency || "TZS")}`
        )
      )
    ),
    React.createElement(
      "div",
      { className: "mh-shop-actions" },
      wa
        ? React.createElement(
            "a",
            { className: "mh-btn secondary", href: wa, target: "_blank" },
            "WhatsApp"
          )
        : null,
      shop.phones?.[0]
        ? React.createElement(
            "a",
            { className: "mh-btn secondary", href: `tel:${shop.phones[0]}` },
            "Call"
          )
        : null,
      React.createElement(
        "button",
        { className: "mh-btn", onClick: onOpen },
        "Open shop"
      )
    )
  );
}

function ItemsTable({ items }) {
  if (!items || items.length === 0) {
    return React.createElement("p", { className: "mh-muted" }, "Hakuna bidhaa bado.");
  }
  return React.createElement(
    "div",
    { className: "mh-items-table" },
    React.createElement(
      "table",
      null,
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement("th", null, "Bidhaa"),
          React.createElement("th", null, "Bei"),
          React.createElement("th", null, "Unit"),
          React.createElement("th", null, "Maelezo"),
          React.createElement("th", null, "Updated")
        )
      ),
      React.createElement(
        "tbody",
        null,
        items.map((item) =>
          React.createElement(
            "tr",
            { key: item.id },
            React.createElement("td", null, item.title || "-"),
            React.createElement(
              "td",
              null,
              formatCurrency(item.price, item.currency || "TZS")
            ),
            React.createElement("td", null, item.unit || "pcs"),
            React.createElement("td", null, item.notes || item.vehicleModel || ""),
            React.createElement("td", null, formatDate(item.updatedAt) || "")
          )
        )
      )
    )
  );
}

function SellerDashboard({ categories, db, auth, onBack }) {
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [user, setUser] = React.useState(auth?.currentUser || null);
  const [status, setStatus] = React.useState("");
  const [shop, setShop] = React.useState({
    shopName: "",
    ownerName: "",
    phonesText: "",
    whatsappPhone: "",
    lipaNumber: "",
    country: "",
    region: "",
    city: "",
    area: "",
    photosText: "",
    categories: {},
  });
  const [itemForm, setItemForm] = React.useState({
    id: null,
    catId: "",
    title: "",
    vehicleModel: "",
    brand: "",
    price: "",
    currency: "TZS",
    unit: "pcs",
    notes: "",
    photoUrl: "",
    status: "active",
  });
  const [myItems, setMyItems] = React.useState([]);

  React.useEffect(() => {
    if (!auth) return;
    const unsub = auth.onAuthStateChanged((u) => setUser(u));
    return () => unsub && unsub();
  }, [auth]);

  React.useEffect(() => {
    if (!db || !user) return;
    const shopRef = db.ref(`marketinghub/public/shops/${user.uid}`);
    const itemsRef = db.ref(`marketinghub/public/items/${user.uid}`);
    const shopCb = (snap) => {
      const val = snap.val() || {};
      setShop((prev) => ({
        ...prev,
        ...val,
        phonesText: (val.phones || []).join(", "),
        photosText: (val.photos || []).join("\n"),
        categories: val.categories || {},
      }));
    };
    const itemCb = (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([id, v]) => ({ id, ...v }));
      arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setMyItems(arr);
    };
    shopRef.on("value", shopCb);
    itemsRef.on("value", itemCb);
    return () => {
      shopRef.off("value", shopCb);
      itemsRef.off("value", itemCb);
    };
  }, [db, user]);

  function handleLogin() {
    if (!auth) return;
    const email = loginToEmail(loginId);
    if (!email || !password) {
      setStatus("Weka phone/email na nenosiri.");
      return;
    }
    setStatus("Signing in...");
    auth
      .signInWithEmailAndPassword(email, password)
      .then(() => setStatus("Signed in"))
      .catch(() =>
        auth
          .createUserWithEmailAndPassword(email, password)
          .then(() => setStatus("Account created, signed in"))
          .catch((err) =>
            setStatus(err?.message || "Auth failed. Check password.")
          )
      );
  }

  async function saveShop() {
    if (!db || !auth || !auth.currentUser) {
      setStatus("Sign in first.");
      return;
    }
    const uid = auth.currentUser.uid;
    const phones = (shop.phonesText || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const photos = (shop.photosText || "")
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 5);
    const payload = {
      shopName: shop.shopName || "",
      ownerName: shop.ownerName || "",
      phones,
      whatsappPhone: shop.whatsappPhone || phones[0] || "",
      lipaNumber: shop.lipaNumber || "",
      country: shop.country || "",
      region: shop.region || "",
      city: shop.city || "",
      area: shop.area || "",
      categories: shop.categories || {},
      photos,
      updatedAt: Date.now(),
      createdAt: shop.createdAt || Date.now(),
    };
    try {
      await db.ref(`marketinghub/public/shops/${uid}`).set(payload);
      setStatus("Shop profile saved.");
    } catch (err) {
      setStatus(err?.message || "Failed to save shop.");
    }
  }

  async function saveItem() {
    if (!db || !auth || !auth.currentUser) {
      setStatus("Sign in first.");
      return;
    }
    if (!itemForm.title || !itemForm.catId) {
      setStatus("Weka jina la bidhaa na soko.");
      return;
    }
    const uid = auth.currentUser.uid;
    const itemsRef = db.ref(`marketinghub/public/items/${uid}`);
    const ref = itemForm.id ? itemsRef.child(itemForm.id) : itemsRef.push();
    const payload = {
      catId: itemForm.catId,
      title: itemForm.title,
      vehicleModel: itemForm.vehicleModel || "",
      brand: itemForm.brand || "",
      price: Number(itemForm.price || 0),
      currency: itemForm.currency || "TZS",
      unit: itemForm.unit || "pcs",
      notes: itemForm.notes || "",
      photoUrl: itemForm.photoUrl || "",
      updatedAt: Date.now(),
      status: itemForm.status || "active",
    };
    try {
      await ref.set(payload);
      setStatus("Item saved.");
      setItemForm({
        id: null,
        catId: itemForm.catId,
        title: "",
        vehicleModel: "",
        brand: "",
        price: "",
        currency: "TZS",
        unit: "pcs",
        notes: "",
        photoUrl: "",
        status: "active",
      });
    } catch (err) {
      setStatus(err?.message || "Failed to save item.");
    }
  }

  function startEditItem(item) {
    setItemForm({
      id: item.id,
      catId: item.catId || "",
      title: item.title || "",
      vehicleModel: item.vehicleModel || "",
      brand: item.brand || "",
      price: item.price || "",
      currency: item.currency || "TZS",
      unit: item.unit || "pcs",
      notes: item.notes || "",
      photoUrl: item.photoUrl || "",
      status: item.status || "active",
    });
  }

  return React.createElement(
    "div",
    { className: "mh-app-shell" },
    React.createElement(
      "header",
      { className: "mh-app-header" },
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center" } },
        React.createElement(
          "button",
          { className: "mh-btn secondary", onClick: onBack },
          "Back"
        ),
        React.createElement(
          "h1",
          { style: { margin: 0, fontSize: "1.8rem", fontWeight: 800 } },
          "Seller Dashboard"
        )
      ),
      React.createElement(
        "p",
        { className: "mh-muted" },
        "Phone/email + PIN. Usalama kwanza: KYC, mawasiliano, na ukomo wa picha (max 5)."
      )
    ),
    React.createElement(
      "main",
      { className: "mh-main" },
      React.createElement(
        "div",
        { className: "mh-grid two" },
        React.createElement(
          "div",
          { className: "mh-app-card" },
          React.createElement("div", { className: "mh-section-title" }, "Seller Login"),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Phone au Email",
            value: loginId,
            onChange: (e) => setLoginId(e.target.value),
          }),
          React.createElement("input", {
            className: "mh-input",
            type: "password",
            placeholder: "Password / PIN",
            value: password,
            onChange: (e) => setPassword(e.target.value),
          }),
          React.createElement(
            "div",
            { style: { display: "flex", gap: 10, marginTop: 10 } },
            React.createElement(
              "button",
              { className: "mh-btn", onClick: handleLogin },
              "Sign in / Create Seller"
            ),
            user
              ? React.createElement(
                  "button",
                  {
                    className: "mh-btn secondary",
                    onClick: () => auth && auth.signOut(),
                  },
                  "Sign out"
                )
              : null
          ),
          React.createElement(
            "p",
            { className: "mh-muted", style: { marginTop: 6 } },
            status
          )
        ),
        React.createElement(
          "div",
          { className: "mh-app-card" },
          React.createElement("div", { className: "mh-section-title" }, "Shop Profile"),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Shop name (e.g. TWINS AUTOSPARES)",
            value: shop.shopName,
            onChange: (e) => setShop({ ...shop, shopName: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Owner name",
            value: shop.ownerName,
            onChange: (e) => setShop({ ...shop, ownerName: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Phones (comma separated)",
            value: shop.phonesText,
            onChange: (e) => setShop({ ...shop, phonesText: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "WhatsApp phone",
            value: shop.whatsappPhone,
            onChange: (e) => setShop({ ...shop, whatsappPhone: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Lipa number (optional)",
            value: shop.lipaNumber,
            onChange: (e) => setShop({ ...shop, lipaNumber: e.target.value }),
          }),
          React.createElement(
            "div",
            { className: "mh-grid two" },
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Country",
              value: shop.country,
              onChange: (e) => setShop({ ...shop, country: e.target.value }),
            }),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Region",
              value: shop.region,
              onChange: (e) => setShop({ ...shop, region: e.target.value }),
            }),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "City",
              value: shop.city,
              onChange: (e) => setShop({ ...shop, city: e.target.value }),
            }),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Area / Street",
              value: shop.area,
              onChange: (e) => setShop({ ...shop, area: e.target.value }),
            })
          ),
          React.createElement(
            "div",
            { className: "mh-section-title", style: { marginTop: 10 } },
            "Soko Categories"
          ),
          React.createElement(
            "div",
            { className: "mh-chip-row" },
            categories.map((cat) =>
              React.createElement(
                "label",
                { key: cat.id, className: "mh-chip selectable" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: Boolean(shop.categories?.[cat.id]),
                  onChange: (e) => {
                    const next = { ...(shop.categories || {}) };
                    if (e.target.checked) {
                      next[cat.id] = true;
                    } else {
                      delete next[cat.id];
                    }
                    setShop({ ...shop, categories: next });
                  },
                }),
                React.createElement("span", null, cat.nameSw || cat.nameEn)
              )
            )
          ),
          React.createElement(
            "label",
            { className: "mh-label" },
            "Photo URLs (max 5, one per line)"
          ),
          React.createElement("textarea", {
            className: "mh-textarea",
            value: shop.photosText,
            onChange: (e) => setShop({ ...shop, photosText: e.target.value }),
          }),
          React.createElement(
            "button",
            { className: "mh-btn", style: { marginTop: 12 }, onClick: saveShop },
            "Save Shop Profile"
          )
        )
      ),
      React.createElement(
        "div",
        { className: "mh-app-card", style: { marginTop: 16 } },
        React.createElement("div", { className: "mh-section-title" }, "Price List / Items"),
        React.createElement(
          "div",
          { className: "mh-grid two" },
          React.createElement(
            "div",
            { className: "mh-grid" },
            React.createElement(
              "label",
              { className: "mh-label" },
              "Soko / Category"
            ),
            React.createElement(
              "select",
              {
                className: "mh-select",
                value: itemForm.catId,
                onChange: (e) =>
                  setItemForm({ ...itemForm, catId: e.target.value }),
              },
              React.createElement("option", { value: "" }, "Select"),
              categories.map((cat) =>
                React.createElement(
                  "option",
                  { key: cat.id, value: cat.id },
                  cat.nameSw || cat.nameEn
                )
              )
            ),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Item title (e.g. Shock absorber)",
              value: itemForm.title,
              onChange: (e) => setItemForm({ ...itemForm, title: e.target.value }),
            }),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Vehicle model (optional)",
              value: itemForm.vehicleModel,
              onChange: (e) =>
                setItemForm({ ...itemForm, vehicleModel: e.target.value }),
            }),
            React.createElement(
              "div",
              { className: "mh-grid two" },
              React.createElement("input", {
                className: "mh-input",
                type: "number",
                placeholder: "Price",
                value: itemForm.price,
                onChange: (e) =>
                  setItemForm({ ...itemForm, price: e.target.value }),
              }),
              React.createElement(
                "select",
                {
                  className: "mh-select",
                  value: itemForm.currency,
                  onChange: (e) =>
                    setItemForm({ ...itemForm, currency: e.target.value }),
                },
                ["TZS", "KES", "USD"].map((c) =>
                  React.createElement("option", { key: c, value: c }, c)
                )
              )
            ),
            React.createElement(
              "div",
              { className: "mh-grid two" },
              React.createElement("input", {
                className: "mh-input",
                placeholder: "Unit (pcs, set, bag...)",
                value: itemForm.unit,
                onChange: (e) =>
                  setItemForm({ ...itemForm, unit: e.target.value }),
              }),
              React.createElement(
                "select",
                {
                  className: "mh-select",
                  value: itemForm.status,
                  onChange: (e) =>
                    setItemForm({ ...itemForm, status: e.target.value }),
                },
                React.createElement("option", { value: "active" }, "Active"),
                React.createElement("option", { value: "inactive" }, "Inactive")
              )
            ),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Photo URL (optional)",
              value: itemForm.photoUrl,
              onChange: (e) =>
                setItemForm({ ...itemForm, photoUrl: e.target.value }),
            }),
            React.createElement("textarea", {
              className: "mh-textarea",
              placeholder: "Notes (stock, fitment, brand, etc.)",
              value: itemForm.notes,
              onChange: (e) =>
                setItemForm({ ...itemForm, notes: e.target.value }),
            }),
            React.createElement(
              "button",
              { className: "mh-btn", onClick: saveItem },
              itemForm.id ? "Update Item" : "Save Item"
            )
          ),
          React.createElement(
            "div",
            { className: "mh-items-table" },
            React.createElement(
              "div",
              { className: "mh-section-title" },
              "Your items"
            ),
            myItems.length === 0
              ? React.createElement(
                  "p",
                  { className: "mh-muted" },
                  "No items yet."
                )
              : React.createElement(
                  "ul",
                  { className: "mh-list" },
                  myItems.map((item) =>
                    React.createElement(
                      "li",
                      { key: item.id, className: "mh-list-item" },
                      React.createElement(
                        "div",
                        null,
                        React.createElement("strong", null, item.title || "Item"),
                        " ",
                        React.createElement(
                          "span",
                          { className: "mh-tag" },
                          item.catId || "-"
                        ),
                        React.createElement(
                          "span",
                          { className: "mh-tag" },
                          formatCurrency(item.price, item.currency || "TZS")
                        )
                      ),
                      React.createElement(
                        "div",
                        { style: { display: "flex", gap: 8 } },
                        React.createElement(
                          "button",
                          {
                            className: "mh-btn secondary",
                            onClick: () => startEditItem(item),
                          },
                          "Edit"
                        )
                      )
                    )
                  )
                )
          )
        )
      )
    )
  );
}

function MarketingHubAppShell() {
  const { hasFb, db, auth } = useFirebase();
  const [view, setView] = React.useState({ page: "home", catId: null, shopId: null });
  const [categories, setCategories] = React.useState([]);
  const [shops, setShops] = React.useState([]);
  const [itemsBySeller, setItemsBySeller] = React.useState({});
  const [user, setUser] = React.useState(null);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [homeSearch, setHomeSearch] = React.useState("");
  const [catFilters, setCatFilters] = React.useState({
    q: "",
    country: "",
    region: "",
    city: "",
    sort: "recent",
  });
  const [shopSearch, setShopSearch] = React.useState("");
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    if (!auth) return;
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u);
      if (u && db) {
        const adminRef = db.ref(`marketinghub/admins/${u.uid}`);
        const cb = (snap) => setIsAdmin(Boolean(snap.val()));
        adminRef.on("value", cb);
        return () => adminRef.off("value", cb);
      }
    });
    return () => unsub && unsub();
  }, [auth, db]);

  React.useEffect(() => {
    if (!auth) return;
    ensureAnonAuth(auth).catch(() => {});
  }, [auth]);

  React.useEffect(() => {
    if (!db) return;
    const catRef = db.ref("marketinghub/public/categories");
    const shopsRef = db.ref("marketinghub/public/shops");
    const itemsRef = db.ref("marketinghub/public/items");
    catRef.on("value", (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val)
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => (a.order || 999) - (b.order || 999));
      setCategories(arr);
      setLoading(false);
    });
    shopsRef.on("value", (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([id, v]) => ({ id, ...v }));
      setShops(arr);
    });
    itemsRef.on("value", (snap) => {
      const val = snap.val() || {};
      const map = {};
      Object.entries(val).forEach(([sellerId, items]) => {
        map[sellerId] = Object.entries(items || {}).map(([id, v]) => ({
          id,
          ...v,
        }));
      });
      setItemsBySeller(map);
    });
    return () => {
      catRef.off();
      shopsRef.off();
      itemsRef.off();
    };
  }, [db]);

  const selectedCategory = categories.find((c) => c.id === view.catId);
  const selectedShop = shops.find((s) => s.id === view.shopId);
  const itemsForSelectedShop = selectedShop
    ? itemsBySeller[selectedShop.id] || []
    : [];

  function categoryStats(catId) {
    const catShops = shops.filter((s) => shopMatchesCategory(s, catId));
    const locations = unique(
      catShops.map((s) => [s.country, s.region, s.city].filter(Boolean).join(" / "))
    );
    let itemsCount = 0;
    catShops.forEach((s) => {
      const items = itemsBySeller[s.id] || [];
      itemsCount += items.filter((i) => i.catId === catId).length;
    });
    return {
      shops: catShops.length,
      items: itemsCount,
      locations: locations.length,
    };
  }

  async function seedCategories() {
    if (!db || !isAdmin) return;
    const payload = {};
    DEFAULT_CATEGORIES.forEach((c) => {
      payload[c.id] = { ...c, enabled: true };
    });
    await db.ref("marketinghub/public/categories").set(payload);
    setStatus("Categories initialized.");
  }

  const filteredCategories = categories.filter((c) => {
    if (!homeSearch) return true;
    const text = `${c.nameSw} ${c.nameEn}`.toLowerCase();
    return text.includes(homeSearch.toLowerCase());
  });

  function renderHome() {
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "header",
        { className: "mh-app-header" },
        React.createElement(
          "div",
          { className: "mh-hero" },
          React.createElement(
            "div",
            null,
            React.createElement("p", { className: "mh-pill" }, "MarketingHub - Real Market"),
            React.createElement(
              "h1",
              null,
              "Soko Directory kwa kila biashara"
            ),
            React.createElement(
              "p",
              { className: "mh-muted" },
              "Chagua soko (Vifaa vya Magari, Magari, Mashamba, Nyumba, Utensils, Electronics...). Stat card inaonyesha shops, items, locations."
            ),
            React.createElement(
              "div",
              { className: "mh-hero-actions" },
              React.createElement(
                "button",
                { className: "mh-btn", onClick: () => setView({ page: "seller" }) },
                "Seller / Muuzaji"
              ),
              React.createElement(
                "button",
                {
                  className: "mh-btn secondary",
                  onClick: () => setStatus("Save Quote coming soon (local memory)"),
                },
                "Save Quote (coming soon)"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "mh-hero-panel" },
            React.createElement(
              "div",
              { className: "mh-section-title" },
              "Enter as buyer"
            ),
            React.createElement(
              "p",
              { className: "mh-muted" },
              "No manual login. Browse sokos, contact sellers via WhatsApp au simu moja kwa moja."
            ),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Tafuta soko...",
              value: homeSearch,
              onChange: (e) => setHomeSearch(e.target.value),
            }),
            isAdmin && categories.length === 0
              ? React.createElement(
                  "button",
                  { className: "mh-btn", onClick: seedCategories },
                  "Initialize default categories"
                )
              : null,
            status
              ? React.createElement("p", { className: "mh-muted" }, status)
              : null
          )
        )
      ),
      React.createElement(
        "main",
        { className: "mh-main" },
        loading && categories.length === 0
          ? React.createElement("p", { className: "mh-muted" }, "Loading categories...")
          : React.createElement(
              "div",
              { className: "mh-stats-grid" },
              filteredCategories.map((cat) =>
                React.createElement(StatCard, {
                  key: cat.id,
                  cat,
                  stats: categoryStats(cat.id),
                  onClick: () => setView({ page: "category", catId: cat.id }),
                })
              )
            )
      )
    );
  }
  function renderCategory() {
    const cat = selectedCategory;
    if (!cat) return renderHome();
    const shopsForCat = shops.filter((s) => shopMatchesCategory(s, cat.id));
    const filteredShops = shopsForCat.filter((s) => {
      const text = `${s.shopName} ${s.ownerName} ${s.region} ${s.city} ${s.area}`.toLowerCase();
      if (catFilters.q && !text.includes(catFilters.q.toLowerCase())) return false;
      if (catFilters.country && (s.country || "").toLowerCase() !== catFilters.country.toLowerCase()) return false;
      if (catFilters.region && (s.region || "").toLowerCase() !== catFilters.region.toLowerCase()) return false;
      if (catFilters.city && (s.city || "").toLowerCase() !== catFilters.city.toLowerCase()) return false;
      return true;
    });
    const catItems = filteredShops.flatMap((shop) =>
      (itemsBySeller[shop.id] || []).filter((i) => i.catId === cat.id && i.status !== "inactive")
    );
    if (catFilters.sort === "cheap") {
      catItems.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else {
      catItems.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "header",
        { className: "mh-app-header" },
        React.createElement(
          "div",
          { className: "mh-breadcrumb" },
          React.createElement(
            "button",
            { className: "mh-btn secondary", onClick: () => setView({ page: "home" }) },
            "Home"
          ),
          React.createElement("span", null, " / "),
          React.createElement("strong", null, cat.nameSw || cat.nameEn)
        ),
        React.createElement(
          "p",
          { className: "mh-muted" },
          "Buyer mode: tafuta shops, piga simu au WhatsApp bila login."
        ),
        React.createElement(
          "div",
          { className: "mh-filters", style: { marginTop: 12 } },
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Search shop / area / owner",
            value: catFilters.q,
            onChange: (e) => setCatFilters({ ...catFilters, q: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Country",
            value: catFilters.country,
            onChange: (e) => setCatFilters({ ...catFilters, country: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Region",
            value: catFilters.region,
            onChange: (e) => setCatFilters({ ...catFilters, region: e.target.value }),
          }),
          React.createElement("input", {
            className: "mh-input",
            placeholder: "City",
            value: catFilters.city,
            onChange: (e) => setCatFilters({ ...catFilters, city: e.target.value }),
          }),
          React.createElement(
            "select",
            {
              className: "mh-select",
              value: catFilters.sort,
              onChange: (e) => setCatFilters({ ...catFilters, sort: e.target.value }),
            },
            React.createElement("option", { value: "recent" }, "Newest"),
            React.createElement("option", { value: "cheap" }, "Cheapest")
          )
        )
      ),
      React.createElement(
        "main",
        { className: "mh-main" },
        filteredShops.length === 0
          ? React.createElement("p", { className: "mh-muted" }, "Hakuna shop bado.")
          : React.createElement(
              "div",
              { className: "mh-grid two" },
              filteredShops.map((shop) =>
                React.createElement(ShopCard, {
                  key: shop.id,
                  shop,
                  items: (itemsBySeller[shop.id] || []).filter((i) => i.catId === cat.id),
                  onOpen: () => setView({ page: "shop", shopId: shop.id, catId: cat.id }),
                })
              )
            ),
        React.createElement(
          "div",
          { className: "mh-app-card", style: { marginTop: 20 } },
          React.createElement("div", { className: "mh-section-title" }, "Items in this soko"),
          ItemsTable({ items: catItems })
        )
      )
    );
  }

  function renderShop() {
    const shop = selectedShop;
    if (!shop) return renderHome();
    const items = (itemsForSelectedShop || [])
      .filter((i) => !view.catId || i.catId === view.catId)
      .filter((i) =>
        shopSearch
          ? (i.title || "").toLowerCase().includes(shopSearch.toLowerCase()) ||
            (i.notes || "").toLowerCase().includes(shopSearch.toLowerCase())
          : true
      )
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const waLink = heroWhatsAppLink(shop);
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "header",
        { className: "mh-app-header" },
        React.createElement(
          "div",
          { className: "mh-breadcrumb" },
          React.createElement(
            "button",
            { className: "mh-btn secondary", onClick: () => setView({ page: "category", catId: view.catId }) },
            "Back to soko"
          ),
          React.createElement("span", null, " / "),
          React.createElement("strong", null, shop.shopName || "Shop")
        ),
        React.createElement(
          "div",
          { className: "mh-shop-profile" },
          React.createElement(
            "div",
            null,
            React.createElement("h2", null, shop.shopName || "Shop"),
            React.createElement(
              "p",
              { className: "mh-muted" },
              [shop.country, shop.region, shop.city, shop.area].filter(Boolean).join(" - ")
            ),
            shop.lipaNumber
              ? React.createElement(
                  "p",
                  { className: "mh-muted" },
                  `Lipa number: ${shop.lipaNumber}`
                )
              : null
          ),
          React.createElement(
            "div",
            { className: "mh-shop-actions" },
            shop.phones?.[0]
              ? React.createElement(
                  "a",
                  { className: "mh-btn secondary", href: `tel:${shop.phones[0]}` },
                  "Call"
                )
              : null,
            shop.phones?.[0]
              ? React.createElement(
                  "a",
                  { className: "mh-btn secondary", href: `sms:${shop.phones[0]}` },
                  "SMS"
                )
              : null,
            waLink
              ? React.createElement(
                  "a",
                  { className: "mh-btn", href: waLink, target: "_blank" },
                  "WhatsApp"
                )
              : null
          )
        ),
        React.createElement("input", {
          className: "mh-input",
          placeholder: "Search this shop items",
          value: shopSearch,
          onChange: (e) => setShopSearch(e.target.value),
          style: { marginTop: 12 },
        })
      ),
      React.createElement(
        "main",
        { className: "mh-main" },
        React.createElement("div", { className: "mh-app-card" }, ItemsTable({ items }))
      )
    );
  }

  if (!hasFb) {
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "main",
        { className: "mh-main" },
        React.createElement("p", null, "Firebase not detected. Please load firebase.js.")
      )
    );
  }

  if (view.page === "seller") {
    return React.createElement(SellerDashboard, {
      categories,
      db,
      auth,
      onBack: () => setView({ page: "home" }),
    });
  }
  if (view.page === "category") return renderCategory();
  if (view.page === "shop") return renderShop();
  return renderHome();
}

export function mountMarketingHubCard({ el }) {
  if (!el) return;
  ensureStyle();
  ensureReact().then(() => {
    const onClick = () => {
      const url = new URL("./index.html", import.meta.url).href;
      window.open(url, "_blank");
    };
    const root = createRootCompat(el);
    root.render(React.createElement(MarketingCard, { onClick }));
  });
}

export function mountMarketingHubApp({ el }) {
  if (!el) return;
  ensureStyle();
  ensureReact().then(() => {
    const root = createRootCompat(el);
    root.render(React.createElement(MarketingHubAppShell));
  });
}
