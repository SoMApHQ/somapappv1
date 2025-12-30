// marketing/marketing.js
// MarketingHub: multi-soko marketplace (React CDN + Firebase RTDB, no build step).

const STYLE_URL = new URL("./marketing.css", import.meta.url).href;
const REACT_URL = "https://unpkg.com/react@18/umd/react.production.min.js";
const REACT_DOM_URL = "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";
const CLOUDINARY_ENDPOINT = "https://api.cloudinary.com/v1_1/dg7vnrkgd/upload";
const CLOUDINARY_PRESET = "somap_unsigned";

const isBrowser = typeof window !== "undefined";

const DEFAULT_CATEGORIES = [
  { id: "vehicle_spares", nameSw: "Soko la Vifaa vya Magari", nameEn: "Vehicle Spares", icon: "CAR-SPARES", order: 1 },
  { id: "cars", nameSw: "Soko la Magari", nameEn: "Cars", icon: "CARS", order: 2 },
  { id: "land", nameSw: "Soko la Mashamba", nameEn: "Land", icon: "LAND", order: 3 },
  { id: "houses", nameSw: "Soko la Nyumba", nameEn: "Houses", icon: "HOUSES", order: 4 },
  { id: "rentals", nameSw: "Soko la Kupanga Nyumba", nameEn: "Rentals", icon: "RENTALS", order: 5 },
  { id: "utensils", nameSw: "Soko la Vyombo", nameEn: "Utensils", icon: "UTENSILS", order: 6 },
  { id: "electronics", nameSw: "Vifaa vya Elektroniki", nameEn: "Electronics & Gadgets", icon: "ELECTRONICS", order: 7 },
  { id: "uniforms", nameSw: "Uniformu na Mahitaji ya Shule", nameEn: "Uniforms & School Supplies", icon: "UNIFORMS", order: 8 },
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
  return loadScriptOnce(REACT_URL, "React").then(() => loadScriptOnce(REACT_DOM_URL, "ReactDOM"));
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
  return { render: (node) => ReactDOM.render(node, el) };
}

function useFirebase() {
  const hasFb = isBrowser && window.firebase && firebase.apps && firebase.apps.length > 0;
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
  if (shop.categories && typeof shop.categories === "object") return Boolean(shop.categories[catId]);
  if (Array.isArray(shop.categories)) return shop.categories.includes(catId);
  return false;
}

function unique(array) {
  return Array.from(new Set(array.filter(Boolean)));
}

function slugifyId(text = "") {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || `custom_${Date.now()}`;
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

function itemWhatsAppLink(shop, item, buyerPhone) {
  const phone = shop?.whatsappPhone || shop?.phones?.[0] || "";
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const amount = `${item.currency || "TZS"} ${Number(item.price || 0).toLocaleString()}`;
  const mine = buyerPhone ? ` Namba yangu ni ${buyerPhone}.` : "";
  const msg =
    `NIMEPATA NAMBA YAKO NA BIDHAA VYAKO KWENYE MFUMO WA SoMAP (SoMApv2i.com) ` +
    `Kwamba unauza ${item.title} kwa shilingi ${amount}, naomba kulipia na kujua jinsi ya kunifikishia.${mine}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}

async function uploadToCloudinary(file, folder = "marketinghub/shops/general", preset = CLOUDINARY_PRESET) {
  const fd = new FormData();
  fd.append("upload_preset", preset);
  if (folder) fd.append("folder", folder);
  fd.append("file", file);
  const res = await fetch(CLOUDINARY_ENDPOINT, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  if (!data.secure_url) throw new Error("No URL returned");
  return data.secure_url;
}

function getCoverPhoto(shop) {
  return (shop?.photos || [])[0] || shop?.profilePhotoUrl || "";
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
        React.createElement("div", { className: "mh-title" }, "Wezesha masoko yote"),
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
  const cover = getCoverPhoto(shop);
  const avatar = shop.profilePhotoUrl || cover;
  const contact = shop.whatsappPhone || (shop.phones || [])[0] || "";
  return React.createElement(
    "div",
    { className: "mh-shop-card" },
    React.createElement(
      "div",
      { className: "mh-shop-head" },
      React.createElement(
        "div",
        { className: "mh-shop-id" },
        avatar
          ? React.createElement("img", { className: "mh-avatar", src: avatar, alt: shop.shopName || "Shop" })
          : React.createElement("div", { className: "mh-avatar placeholder" }, (shop.shopName || "Soko").slice(0, 2).toUpperCase()),
        React.createElement(
          "div",
          null,
          React.createElement("h3", null, shop.shopName || "Shop"),
          React.createElement(
            "p",
            { className: "mh-muted" },
            [shop.country, shop.region, shop.city, shop.area].filter(Boolean).join(" - ")
          ),
          React.createElement(
            "p",
            { className: "mh-muted" },
            contact ? `Mawasiliano: ${contact}` : "Mawasiliano hayajawekwa"
          )
        )
      ),
      shop.verifiedStatus === "verified" ? React.createElement("span", { className: "mh-badge" }, "Verified") : null
      ),
    cover
      ? React.createElement(
          "div",
          { className: "mh-shop-cover" },
          React.createElement("img", { src: cover, alt: `${shop.shopName || "Shop"} cover` })
        )
      : null,
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
      wa ? React.createElement("a", { className: "mh-btn secondary", href: wa, target: "_blank" }, "WhatsApp") : null,
      shop.phones?.[0]
        ? React.createElement("a", { className: "mh-btn secondary", href: `tel:${shop.phones[0]}` }, "Call")
        : null,
      React.createElement("button", { className: "mh-btn", onClick: onOpen }, "Open shop")
    )
  );
}

function ItemsTable({ items }) {
  if (!items || items.length === 0) return React.createElement("p", { className: "mh-muted" }, "Hakuna bidhaa bado.");
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
            React.createElement("td", null, formatCurrency(item.price, item.currency || "TZS")),
            React.createElement("td", null, item.unit || "pcs"),
            React.createElement("td", null, item.notes || item.vehicleModel || ""),
            React.createElement("td", null, formatDate(item.updatedAt) || "")
          )
        )
      )
    )
  );
}

function ItemsGrid({ items, shop, buyerPhone }) {
  if (!items || items.length === 0) return React.createElement("p", { className: "mh-muted" }, "Hakuna bidhaa bado.");
  return React.createElement(
    "div",
    { className: "mh-grid items" },
    items.map((item) => {
      const itemShop = shop || item.__shop || {};
      const wa = itemWhatsAppLink(itemShop, item, buyerPhone);
      const call = itemShop?.phones?.[0] ? `tel:${itemShop.phones[0]}` : null;
      const photo = item.photoUrl || getCoverPhoto(itemShop);
      return React.createElement(
        "div",
        { key: item.id, className: "mh-item-card" },
        photo ? React.createElement("img", { className: "mh-item-photo", src: photo, alt: item.title || "Item" }) : null,
        React.createElement(
          "div",
          { className: "mh-item-body" },
          React.createElement(
            "div",
            { className: "mh-item-top" },
            React.createElement("strong", null, item.title || "Bidhaa"),
            React.createElement("span", { className: "mh-tag" }, formatCurrency(item.price, item.currency || "TZS"))
          ),
          item.vehicleModel ? React.createElement("p", { className: "mh-muted" }, item.vehicleModel) : null,
          item.notes ? React.createElement("p", { className: "mh-muted" }, item.notes) : null,
          React.createElement(
            "div",
            { className: "mh-item-actions" },
            wa ? React.createElement("a", { className: "mh-btn", href: wa, target: "_blank" }, "WhatsApp kununua") : null,
            call ? React.createElement("a", { className: "mh-btn secondary", href: call }, "Piga simu") : null
          )
        )
      );
    })
  );
}

function PhotoDropzone({ label, max = 5, value = [], onAdd, onRemove, folder, disabled }) {
  const [isDragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const inputRef = React.useRef(null);
  const current = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  const limitReached = current.length >= max;

  async function handleFiles(fileList) {
    if (disabled || uploading) return;
    setMessage("");
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setMessage("Chagua picha tu.");
      return;
    }
    const remaining = max - current.length;
    if (remaining <= 0 || files.length > remaining) {
      setMessage(`Max ${max} photos. Delete old first.`);
      return;
    }
    setUploading(true);
    const urls = [];
    for (const file of files) {
      try {
        const url = await uploadToCloudinary(file, folder);
        urls.push(url);
      } catch (e) {
        setMessage("Upload failed, try again.");
      }
    }
    if (urls.length && onAdd) onAdd(urls);
    setUploading(false);
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled || limitReached || uploading) return;
    handleFiles(e.dataTransfer.files);
  }

  return React.createElement(
    "div",
    { className: "mh-dropzone" },
    React.createElement(
      "div",
      { className: "mh-drop-header" },
      React.createElement("span", null, label || "Picha"),
      React.createElement("span", { className: "mh-muted" }, `${current.length}/${max} photos`)
    ),
    React.createElement(
      "div",
      {
        className: `mh-drop-area ${isDragging ? "dragging" : ""} ${limitReached ? "disabled" : ""}`,
        onDragOver: (e) => {
          e.preventDefault();
          if (!disabled && !uploading) setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop,
        onClick: () => !disabled && !limitReached && !uploading && inputRef.current && inputRef.current.click(),
      },
      uploading ? "Uploading..." : limitReached ? "Max photos reached - delete to add" : "Drag & drop or click to upload"
    ),
    React.createElement("input", {
      type: "file",
      accept: "image/*",
      multiple: max > 1,
      ref: inputRef,
      style: { display: "none" },
      disabled: disabled || limitReached || uploading,
      onChange: (e) => handleFiles(e.target.files),
    }),
    message ? React.createElement("p", { className: "mh-muted" }, message) : null,
    current.length
      ? React.createElement(
          "div",
          { className: "mh-drop-grid" },
          current.map((url, idx) =>
            React.createElement(
              "div",
              { key: url + idx, className: "mh-drop-thumb" },
              React.createElement("img", { src: url, alt: `photo-${idx}` }),
              onRemove
                ? React.createElement(
                    "button",
                    {
                      className: "mh-btn secondary",
                      onClick: () => onRemove(idx),
                    },
                    "Delete"
                  )
                : null
            )
          )
        )
      : null
  );
}
function SellerDashboard({ categories, db, auth, onBack }) {
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [user, setUser] = React.useState(auth?.currentUser || null);
  const [status, setStatus] = React.useState("");
  const statusTimerRef = React.useRef(null);
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
    categories: {},
  });
  const [shopPhotos, setShopPhotos] = React.useState([]);
  const [profilePhoto, setProfilePhoto] = React.useState("");
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [newCategoryIcon, setNewCategoryIcon] = React.useState("SOKO");
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
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

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
        categories: val.categories || {},
      }));
      setShopPhotos((val.photos || []).slice(0, 5));
      setProfilePhoto(val.profilePhotoUrl || "");
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

  function showStatus(msg) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus(msg);
    if (msg) statusTimerRef.current = setTimeout(() => setStatus(""), 2600);
  }

  function handleLogin() {
    if (!auth) return;
    const normalizedLogin = (loginId || "").trim();
    const email = loginToEmail(normalizedLogin);
    if (!email || !password) {
      showStatus("Weka phone/email na nenosiri.");
      return;
    }
    showStatus("Signing in...");
    auth
      .signInWithEmailAndPassword(email, password)
      .then((cred) => {
        setUser(cred?.user || auth.currentUser);
        setPassword("");
        showStatus("Signed in");
      })
      .catch(() =>
        auth
          .createUserWithEmailAndPassword(email, password)
          .then((cred) => {
            setUser(cred?.user || auth.currentUser);
            setPassword("");
            showStatus("Account created, signed in");
          })
          .catch((err) => {
            setPassword("");
            showStatus(err?.message || "Auth failed. Check password.");
          })
      );
  }

  async function saveShop() {
    if (!db || !auth || !auth.currentUser) {
      showStatus("Sign in first.");
      return;
    }
    const uid = auth.currentUser.uid;
    const phones = (shop.phonesText || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
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
      photos: shopPhotos.slice(0, 5),
      profilePhotoUrl: profilePhoto || "",
      updatedAt: Date.now(),
      createdAt: shop.createdAt || Date.now(),
    };
    try {
      await db.ref(`marketinghub/public/shops/${uid}`).set(payload);
      showStatus("Shop profile saved.");
    } catch (err) {
      showStatus(err?.message || "Failed to save shop.");
    }
  }

  async function saveItem() {
    if (!db || !auth || !auth.currentUser) {
      showStatus("Sign in first.");
      return;
    }
    if (!itemForm.title || !itemForm.catId) {
      showStatus("Weka jina la bidhaa na soko.");
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
      showStatus("Item saved.");
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
      showStatus(err?.message || "Failed to save item.");
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

  const signedInLabel = user
    ? shop.shopName || loginId || user.email || "Seller"
    : "Not signed in";
  const shopFolder = user ? `marketinghub/shops/${user.uid}` : "marketinghub/shops/anon";
  const itemFolder = user ? `marketinghub/items/${user.uid}` : "marketinghub/items/anon";
  const availableCategories = categories && categories.length ? categories : DEFAULT_CATEGORIES;

  async function addNewCategory() {
    if (!db || !auth || !auth.currentUser) {
      showStatus("Sign in first.");
      return;
    }
    const name = (newCategoryName || "").trim();
    if (!name) {
      showStatus("Weka jina la soko.");
      return;
    }
    const id = slugifyId(name);
    const catData = {
      id,
      nameSw: name,
      nameEn: name,
      icon: (newCategoryIcon || "SOKO").toUpperCase(),
      order: (categories?.length || DEFAULT_CATEGORIES.length) + 1,
      enabled: true,
      createdBy: auth.currentUser.uid,
      createdAt: Date.now(),
    };
    try {
      await db.ref(`marketinghub/public/categories/${id}`).set(catData);
      setNewCategoryName("");
      showStatus("Soko limeongezwa.");
      setShop((prev) => ({ ...prev, categories: { ...(prev.categories || {}), [id]: true } }));
    } catch (err) {
      showStatus(err?.message || "Imeshindikana kuongeza soko.");
    }
  }

  async function seedDefaultCategories() {
    if (!db || !auth) {
      showStatus("Sign in first.");
      return;
    }
    const payload = {};
    DEFAULT_CATEGORIES.forEach((c) => {
      payload[c.id] = { ...c, enabled: true };
    });
    try {
      await db.ref("marketinghub/public/categories").set(payload);
      showStatus("Default sokos added.");
    } catch (err) {
      showStatus(err?.message || "Imeshindikana kuweka sokos.");
    }
  }

  return React.createElement(
    "div",
    { className: "mh-app-shell" },
    status ? React.createElement("div", { className: "mh-toast" }, status) : null,
    React.createElement(
      "header",
      { className: "mh-app-header" },
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center" } },
        React.createElement("button", { className: "mh-btn secondary", onClick: onBack }, "Back"),
        React.createElement("h1", { style: { margin: 0, fontSize: "1.8rem", fontWeight: 800 } }, "Seller Dashboard")
      ),
      React.createElement(
        "div",
        { className: "mh-signed" },
        user
          ? React.createElement(
              React.Fragment,
              null,
              profilePhoto || shopPhotos[0]
                ? React.createElement("img", { className: "mh-avatar", src: profilePhoto || shopPhotos[0], alt: signedInLabel })
                : React.createElement("div", { className: "mh-avatar placeholder" }, signedInLabel.slice(0, 2).toUpperCase()),
              React.createElement(
                "div",
                null,
                React.createElement("p", { className: "mh-muted" }, "Signed in as"),
                React.createElement("strong", null, signedInLabel)
              ),
              React.createElement(
                "button",
                { className: "mh-btn secondary", onClick: () => auth && auth.signOut() },
                "Sign out"
              )
            )
          : React.createElement(
              "div",
              null,
              React.createElement("p", { className: "mh-muted" }, "Seller login: Phone/Email + PIN. Usalama kwanza."),
              React.createElement("strong", null, "Not signed in")
            )
      )
    ),
    React.createElement(
      "main",
      { className: "mh-main" },
      React.createElement(
        "div",
        { className: "mh-grid two" },
        !user
          ? React.createElement(
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
                React.createElement("button", { className: "mh-btn", onClick: handleLogin }, "Sign in / Create Seller")
              )
            )
          : React.createElement(
              "div",
              { className: "mh-app-card" },
              React.createElement("div", { className: "mh-section-title" }, "Logged in"),
              React.createElement("p", { className: "mh-muted" }, `Signed in as ${signedInLabel}`),
              React.createElement(
                "button",
                { className: "mh-btn secondary", onClick: () => auth && auth.signOut() },
                "Sign out"
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
          React.createElement("div", { className: "mh-section-title", style: { marginTop: 10 } }, "Soko Categories"),
          React.createElement(
            "div",
            { className: "mh-chip-row" },
            availableCategories.map((cat) =>
              React.createElement(
                "label",
                { key: cat.id, className: "mh-chip selectable" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: Boolean(shop.categories?.[cat.id]),
                  onChange: (e) => {
                    const next = { ...(shop.categories || {}) };
                    if (e.target.checked) next[cat.id] = true;
                    else delete next[cat.id];
                    setShop({ ...shop, categories: next });
                  },
                }),
                React.createElement("span", null, cat.nameSw || cat.nameEn)
              )
            )
          ),
          availableCategories.length === 0
            ? React.createElement("p", { className: "mh-muted" }, "Hakuna sokos bado. Ongeza mpya chini.")
            : null,
          React.createElement(
            "div",
            { className: "mh-grid two", style: { marginTop: 8 } },
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Add new soko (e.g. Vifaa vya Magari)",
              value: newCategoryName,
              onChange: (e) => setNewCategoryName(e.target.value),
            }),
            React.createElement("input", {
              className: "mh-input",
              placeholder: "Icon/label (optional, e.g. SOKO)",
              value: newCategoryIcon,
              onChange: (e) => setNewCategoryIcon(e.target.value),
            })
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" } },
            React.createElement(
              "button",
              { className: "mh-btn secondary", onClick: addNewCategory, disabled: !user },
              "Add soko"
            ),
            categories.length === 0
              ? React.createElement(
                  "button",
                  { className: "mh-btn secondary", onClick: seedDefaultCategories, disabled: !user },
                  "Load default sokos"
                )
              : null
          ),
          React.createElement(PhotoDropzone, {
            label: "Profile picture (optional)",
            max: 1,
            value: profilePhoto ? [profilePhoto] : [],
            onAdd: (urls) => setProfilePhoto(urls[0]),
            onRemove: () => setProfilePhoto(""),
            folder: `${shopFolder}`,
            disabled: !user,
          }),
          React.createElement(PhotoDropzone, {
            label: "Shop photos",
            max: 5,
            value: shopPhotos,
            onAdd: (urls) => setShopPhotos((prev) => [...prev, ...urls].slice(0, 5)),
            onRemove: (idx) => setShopPhotos((prev) => prev.filter((_, i) => i !== idx)),
            folder: `${shopFolder}`,
            disabled: !user,
          }),
          React.createElement(
            "button",
            { className: "mh-btn", style: { marginTop: 12 }, onClick: saveShop, disabled: !user },
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
            React.createElement("label", { className: "mh-label" }, "Soko / Category"),
            React.createElement(
              "select",
              {
                className: "mh-select",
                value: itemForm.catId,
                onChange: (e) => setItemForm({ ...itemForm, catId: e.target.value }),
              },
              React.createElement("option", { value: "" }, "Select"),
              availableCategories.map((cat) =>
                React.createElement("option", { key: cat.id, value: cat.id }, cat.nameSw || cat.nameEn)
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
              onChange: (e) => setItemForm({ ...itemForm, vehicleModel: e.target.value }),
            }),
            React.createElement(
              "div",
              { className: "mh-grid two" },
              React.createElement("input", {
                className: "mh-input",
                type: "number",
                placeholder: "Price",
                value: itemForm.price,
                onChange: (e) => setItemForm({ ...itemForm, price: e.target.value }),
              }),
              React.createElement(
                "select",
                {
                  className: "mh-select",
                  value: itemForm.currency,
                  onChange: (e) => setItemForm({ ...itemForm, currency: e.target.value }),
                },
                ["TZS", "KES", "USD"].map((c) => React.createElement("option", { key: c, value: c }, c))
              )
            ),
            React.createElement(
              "div",
              { className: "mh-grid two" },
              React.createElement("input", {
                className: "mh-input",
                placeholder: "Unit (pcs, set, bag...)",
                value: itemForm.unit,
                onChange: (e) => setItemForm({ ...itemForm, unit: e.target.value }),
              }),
              React.createElement(
                "select",
                {
                  className: "mh-select",
                  value: itemForm.status,
                  onChange: (e) => setItemForm({ ...itemForm, status: e.target.value }),
                },
                React.createElement("option", { value: "active" }, "Active"),
                React.createElement("option", { value: "inactive" }, "Inactive")
              )
            ),
            React.createElement(PhotoDropzone, {
              label: "Item photo (optional)",
              max: 1,
              value: itemForm.photoUrl ? [itemForm.photoUrl] : [],
              onAdd: (urls) => setItemForm({ ...itemForm, photoUrl: urls[0] }),
              onRemove: () => setItemForm({ ...itemForm, photoUrl: "" }),
              folder: `${itemFolder}`,
              disabled: !user,
            }),
            React.createElement("textarea", {
              className: "mh-textarea",
              placeholder: "Notes (stock, fitment, brand, etc.)",
              value: itemForm.notes,
              onChange: (e) => setItemForm({ ...itemForm, notes: e.target.value }),
            }),
            React.createElement(
              "button",
              { className: "mh-btn", onClick: saveItem, disabled: !user },
              itemForm.id ? "Update Item" : "Save Item"
            )
          ),
          React.createElement(
            "div",
            { className: "mh-items-table" },
            React.createElement("div", { className: "mh-section-title" }, "Your items"),
            myItems.length === 0
              ? React.createElement("p", { className: "mh-muted" }, "No items yet.")
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
                        React.createElement("span", { className: "mh-tag" }, item.catId || "-"),
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
                          { className: "mh-btn secondary", onClick: () => startEditItem(item) },
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
  const [catFilters, setCatFilters] = React.useState({ q: "", country: "", region: "", city: "", sort: "recent" });
  const [shopSearch, setShopSearch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const seededCategoriesRef = React.useRef(false);
  const [buyerPhone, setBuyerPhone] = React.useState("");

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
    if (!isBrowser) return;
    const saved = localStorage.getItem("mh_buyer_phone");
    if (saved) setBuyerPhone(saved);
  }, []);

  function persistBuyerPhone(val) {
    setBuyerPhone(val);
    if (isBrowser) localStorage.setItem("mh_buyer_phone", val);
  }

  React.useEffect(() => {
    if (!db) return;
    const catRef = db.ref("marketinghub/public/categories");
    const shopsRef = db.ref("marketinghub/public/shops");
    const itemsRef = db.ref("marketinghub/public/items");
    catRef.on("value", (snap) => {
      const val = snap.val() || {};
      const entries = Object.entries(val);
      if (entries.length === 0 && !seededCategoriesRef.current) {
        seededCategoriesRef.current = true;
        const payload = {};
        DEFAULT_CATEGORIES.forEach((c) => {
          payload[c.id] = { ...c, enabled: true };
        });
        catRef.set(payload).catch(() => {});
        setCategories(DEFAULT_CATEGORIES);
        setLoading(false);
        return;
      }
      if (entries.length === 0) {
        setCategories(DEFAULT_CATEGORIES);
        setLoading(false);
        return;
      }
      const arr = entries
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
        map[sellerId] = Object.entries(items || {}).map(([id, v]) => ({ id, ...v }));
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
  const itemsForSelectedShop = selectedShop ? itemsBySeller[selectedShop.id] || [] : [];

  function categoryStats(catId) {
    const catShops = shops.filter((s) => shopMatchesCategory(s, catId));
    const locations = unique(catShops.map((s) => [s.country, s.region, s.city].filter(Boolean).join(" / ")));
    let itemsCount = 0;
    catShops.forEach((s) => {
      const items = itemsBySeller[s.id] || [];
      itemsCount += items.filter((i) => i.catId === catId).length;
    });
    return { shops: catShops.length, items: itemsCount, locations: locations.length };
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
            React.createElement("h1", null, "Soko Directory kwa kila biashara"),
            React.createElement(
              "p",
              { className: "mh-muted" },
              "Chagua soko (Vifaa vya Magari, Magari, Mashamba, Nyumba, Utensils, Electronics...). Stat card inaonyesha shops, items, locations."
            ),
            React.createElement(
              "div",
              { className: "mh-hero-actions" },
              React.createElement("button", { className: "mh-btn", onClick: () => setView({ page: "seller" }) }, "Seller / Muuzaji"),
              React.createElement(
                "button",
                { className: "mh-btn secondary", onClick: () => setStatus("Save Quote coming soon (local memory)") },
                "Save Quote (coming soon)"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "mh-hero-panel" },
            React.createElement("div", { className: "mh-section-title" }, "Enter as buyer"),
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
              ? React.createElement("button", { className: "mh-btn", onClick: seedCategories }, "Initialize default categories")
              : null,
            status ? React.createElement("p", { className: "mh-muted" }, status) : null
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
      (itemsBySeller[shop.id] || [])
        .filter((i) => i.catId === cat.id && i.status !== "inactive")
        .map((i) => ({ ...i, __shop: shop }))
    );
    if (catFilters.sort === "cheap") catItems.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    else catItems.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement(
        "header",
        { className: "mh-app-header" },
        React.createElement(
          "div",
          { className: "mh-breadcrumb" },
          React.createElement("button", { className: "mh-btn secondary", onClick: () => setView({ page: "home" }) }, "Home"),
          React.createElement("span", null, " / "),
          React.createElement("strong", null, cat.nameSw || cat.nameEn)
        ),
        React.createElement("p", { className: "mh-muted" }, "Buyer mode: tafuta shops, piga simu au WhatsApp bila login."),
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
          React.createElement("input", {
            className: "mh-input",
            placeholder: "Namba yako (optional, inaingia WhatsApp message)",
            value: buyerPhone,
            onChange: (e) => persistBuyerPhone(e.target.value),
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
          React.createElement("div", { className: "mh-section-title" }, "Bidhaa za soko hili"),
          React.createElement(ItemsGrid, {
            items: catItems,
            shop: null,
            buyerPhone,
          })
        )
      )
    );
  }

  function renderShop() {
    const shop = selectedShop;
    if (!shop) return renderHome();
    const contact = shop.whatsappPhone || (shop.phones || [])[0] || "";
    const items = (itemsForSelectedShop || [])
      .filter((i) => !view.catId || i.catId === view.catId)
      .filter((i) =>
        shopSearch
          ? (i.title || "").toLowerCase().includes(shopSearch.toLowerCase()) || (i.notes || "").toLowerCase().includes(shopSearch.toLowerCase())
          : true
      )
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const waLink = heroWhatsAppLink(shop);
    const gallery = (shop.photos || []).slice(0, 5);
    const cover = getCoverPhoto(shop);
    const avatar = shop.profilePhotoUrl || cover;
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
            { className: "mh-shop-id" },
            avatar
              ? React.createElement("img", { className: "mh-avatar", src: avatar, alt: shop.shopName || "Shop" })
              : React.createElement("div", { className: "mh-avatar placeholder" }, (shop.shopName || "Shop").slice(0, 2).toUpperCase()),
            React.createElement(
              "div",
              null,
              React.createElement("h2", null, shop.shopName || "Shop"),
              React.createElement(
                "p",
                { className: "mh-muted" },
                [shop.country, shop.region, shop.city, shop.area].filter(Boolean).join(" - ")
              ),
              React.createElement("p", { className: "mh-muted" }, contact ? `Mawasiliano: ${contact}` : "Mawasiliano hayajawekwa"),
              shop.lipaNumber ? React.createElement("p", { className: "mh-muted" }, `Lipa number: ${shop.lipaNumber}`) : null
            )
          ),
          React.createElement(
            "div",
            { className: "mh-shop-actions" },
            shop.phones?.[0]
              ? React.createElement("a", { className: "mh-btn secondary", href: `tel:${shop.phones[0]}` }, "Call")
              : null,
            shop.phones?.[0]
              ? React.createElement("a", { className: "mh-btn secondary", href: `sms:${shop.phones[0]}` }, "SMS")
              : null,
            waLink ? React.createElement("a", { className: "mh-btn", href: waLink, target: "_blank" }, "WhatsApp") : null
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
        gallery.length
          ? React.createElement(
              "div",
              { className: "mh-app-card" },
              React.createElement("div", { className: "mh-section-title" }, "Shop gallery"),
              React.createElement(
                "div",
                { className: "mh-drop-grid" },
                gallery.map((url, idx) => React.createElement("div", { key: url + idx, className: "mh-drop-thumb" }, React.createElement("img", { src: url, alt: `shop-photo-${idx}` })))
              )
            )
          : null,
        React.createElement(
          "div",
          { className: "mh-app-card" },
          React.createElement("div", { className: "mh-section-title" }, "Bidhaa"),
          React.createElement(ItemsGrid, { items, shop, buyerPhone })
        )
      )
    );
  }

  if (!hasFb) {
    return React.createElement(
      "div",
      { className: "mh-app-shell" },
      React.createElement("main", { className: "mh-main" }, React.createElement("p", null, "Firebase not detected. Please load firebase.js."))
    );
  }

  if (view.page === "seller") {
    return React.createElement(SellerDashboard, { categories, db, auth, onBack: () => setView({ page: "home" }) });
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
