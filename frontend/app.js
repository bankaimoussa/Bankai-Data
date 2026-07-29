// ============ State ============
let token = localStorage.getItem("da_token") || null;
let branches = [];
let currentBranch = null;
let currentData = [];
let searchTerm = "";
let pollTimer = null;
let editingRow = null;

// ============ Elements ============
const loginScreen = document.getElementById("loginScreen");
const app = document.getElementById("app");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("passwordInput");
const loginError = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const branchTabs = document.getElementById("branchTabs");
const cardsGrid = document.getElementById("cardsGrid");
const emptyState = document.getElementById("emptyState");
const countLabel = document.getElementById("countLabel");
const searchInput = document.getElementById("searchInput");
const addNewBtn = document.getElementById("addNewBtn");
const emptyAddBtn = document.getElementById("emptyAddBtn");
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalClose = document.getElementById("modalClose");
const cancelBtn = document.getElementById("cancelBtn");
const daForm = document.getElementById("daForm");
const deleteBtn = document.getElementById("deleteBtn");
const formMsg = document.getElementById("formMsg");
const toast = document.getElementById("toast");
const syncDot = document.querySelector(".sync-dot");
const syncText = document.getElementById("syncText");

// ============ API helper ============
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (res.status === 401) {
    logout();
    throw new Error("الجلسة منتهية");
  }
  if (!data.success) throw new Error(data.message || "حصل خطأ");
  return data;
}

// ============ Auth ============
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "جارِ الدخول...";
  try {
    if (API_BASE.includes("PASTE_YOUR")) {
      throw new Error("لازم تحط رابط الباك اند في config.js الأول");
    }
    const res = await fetch(API_BASE + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    token = data.token;
    localStorage.setItem("da_token", token);
    await boot();
  } catch (err) {
    loginError.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "دخول";
  }
});

function logout() {
  token = null;
  localStorage.removeItem("da_token");
  clearInterval(pollTimer);
  app.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}
logoutBtn.addEventListener("click", logout);

// ============ Boot ============
async function boot() {
  loginScreen.classList.add("hidden");
  app.classList.remove("hidden");
  try {
    const res = await api("/api/branches");
    branches = res.branches;
    renderBranchTabs();
    if (branches.length) selectBranch(branches[0]);
    startPolling();
  } catch (err) {
    showToast(err.message, "err");
  }
}

function renderBranchTabs() {
  branchTabs.innerHTML = "";
  branches.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "branch-tab" + (b === currentBranch ? " active" : "");
    btn.textContent = b;
    btn.addEventListener("click", () => selectBranch(b));
    branchTabs.appendChild(btn);
  });
}

function selectBranch(b) {
  currentBranch = b;
  renderBranchTabs();
  loadData();
}

// ============ Data loading + polling ============
async function loadData(silent) {
  if (!currentBranch) return;
  if (!silent) setSyncState("syncing");
  try {
    const res = await api(`/api/branch/${currentBranch}`);
    currentData = res.data;
    renderCards();
    setSyncState("ok");
  } catch (err) {
    setSyncState("error");
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadData(true), POLL_INTERVAL_MS);
}

function setSyncState(state) {
  syncDot.className = "sync-dot" + (state === "syncing" ? " syncing" : state === "error" ? " error" : "");
  syncText.textContent = state === "syncing" ? "جارِ التحديث..." : state === "error" ? "تعذّر الاتصال" : "متصل بالشيت";
}

// ============ Render cards ============
function renderCards() {
  const filtered = currentData.filter(d => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (d.daName || "").toLowerCase().includes(s) ||
           (d.nationalId || "").includes(s) ||
           (d.vehiclePlate || "").toLowerCase().includes(s) ||
           (d.phone || "").includes(s);
  });

  countLabel.textContent = `${filtered.length} مندوب`;
  cardsGrid.innerHTML = "";

  if (!filtered.length) {
    emptyState.classList.remove("hidden");
    cardsGrid.classList.add("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  cardsGrid.classList.remove("hidden");

  filtered.forEach(d => {
    const card = document.createElement("div");
    const expiryClass = getExpiryClass(d.licenseExpiration);
    const statusClass = expiryClass === "expiry-warn" ? "status-danger" : expiryClass === "expiry-soon" ? "status-warn" : "status-ok";
    card.className = "da-card " + statusClass;
    const initials = (d.daName || "?").trim().split(" ").slice(0, 2).map(w => w[0]).join("");
    const isFlex = d.flex === "TRUE" || d.flex === true;

    card.innerHTML = `
      <div class="da-card-head">
        <div class="avatar">${escapeHtml(initials)}</div>
        <div class="da-card-heading">
          <p class="da-card-name">${escapeHtml(d.daName)}</p>
          <p class="da-card-vendor">${escapeHtml(d.vendor || "-")}${isFlex ? ' <span class="badge-flex">FLEX</span>' : ""}</p>
        </div>
      </div>
      <div class="da-card-grid">
        <div class="da-cell">
          <span class="cell-label">الرقم القومي</span>
          <span class="cell-value">${escapeHtml(d.nationalId || "-")}</span>
        </div>
        <div class="da-cell">
          <span class="cell-label">الهاتف</span>
          <span class="cell-value">${escapeHtml(d.phone || "-")}</span>
        </div>
        <div class="da-cell">
          <span class="cell-label">المركبة</span>
          <span class="cell-value ar">${escapeHtml(d.vehicleType || "-")} · ${escapeHtml(d.vehiclePlate || "-")}</span>
        </div>
        <div class="da-cell">
          <span class="cell-label">انتهاء الرخصة</span>
          <span class="cell-value ${expiryClass}">${escapeHtml(d.licenseExpiration || "-")}</span>
        </div>
      </div>
      <div class="da-card-footer">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5s5 3.2 5 7.2a5 5 0 01-10 0c0-4 5-7.2 5-7.2z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8.5" r="1.6" stroke="currentColor" stroke-width="1.3"/></svg>
        <span>${escapeHtml(truncate(d.address, 30))}</span>
      </div>
    `;
    card.addEventListener("click", () => openEditModal(d));
    cardsGrid.appendChild(card);
  });
}

function getExpiryClass(dateStr) {
  if (!dateStr) return "";
  const d = parseDate(dateStr);
  if (!d) return "";
  const days = (d - new Date()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "expiry-warn";
  if (days < 30) return "expiry-soon";
  return "";
}
function parseDate(str) {
  if (!str) return null;
  const parts = str.split(/[\/\-]/);
  if (parts.length !== 3) return new Date(str);
  if (parts[0].length === 4) return new Date(str);
  return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
}
function truncate(s, n) { return (s || "-").length > n ? s.slice(0, n) + "…" : (s || "-"); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============ Search ============
searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.trim();
  renderCards();
});

// ============ Modal open/close ============
const fieldMap = {
  daName: "f_daName", nationalId: "f_nationalId", vendor: "f_vendor",
  email: "f_email", phone: "f_phone", transporterId: "f_transporterId",
  vehicleType: "f_vehicleType", vehiclePlate: "f_vehiclePlate", modelType: "f_modelType",
  licenseNumber: "f_licenseNumber", licenseType: "f_licenseType",
  licenseIssuance: "f_licenseIssuance", licenseExpiration: "f_licenseExpiration",
  dob: "f_dob", address: "f_address"
};

function openAddModal() {
  editingRow = null;
  modalTitle.textContent = "إضافة مندوب جديد";
  daForm.reset();
  document.getElementById("f_vendor").value = "RAWA";
  document.getElementById("f_vehicleType").value = "Motorbike";
  deleteBtn.classList.add("hidden");
  formMsg.textContent = "";
  modalOverlay.classList.remove("hidden");
}

function openEditModal(d) {
  editingRow = d.rowIndex;
  modalTitle.textContent = "تعديل بيانات المندوب";
  Object.entries(fieldMap).forEach(([key, id]) => {
    document.getElementById(id).value = d[key] || "";
  });
  document.getElementById("f_flex").checked = d.flex === "TRUE" || d.flex === true;
  deleteBtn.classList.remove("hidden");
  formMsg.textContent = "";
  modalOverlay.classList.remove("hidden");
}

function closeModal() {
  modalOverlay.classList.add("hidden");
}

addNewBtn.addEventListener("click", openAddModal);
emptyAddBtn.addEventListener("click", openAddModal);
modalClose.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

// ============ Save (add / edit) ============
daForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg.textContent = "";
  const payload = { siteCode: currentBranch };
  Object.entries(fieldMap).forEach(([key, id]) => {
    payload[key] = document.getElementById(id).value;
  });
  payload.flex = document.getElementById("f_flex").checked ? "TRUE" : "FALSE";

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "جارِ الحفظ...";

  try {
    if (editingRow) {
      await api(`/api/branch/${currentBranch}/${editingRow}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      showToast("تم حفظ التعديلات", "ok");
    } else {
      await api(`/api/branch/${currentBranch}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showToast("تمت إضافة المندوب", "ok");
    }
    closeModal();
    loadData();
  } catch (err) {
    formMsg.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "حفظ";
  }
});

// ============ Delete ============
deleteBtn.addEventListener("click", async () => {
  if (!editingRow) return;
  if (!confirm("متأكد إنك عايز تحذف بيانات المندوب ده؟")) return;
  try {
    await api(`/api/branch/${currentBranch}/${editingRow}`, { method: "DELETE" });
    showToast("تم الحذف", "ok");
    closeModal();
    loadData();
  } catch (err) {
    showToast(err.message, "err");
  }
});

// ============ Toast ============
function showToast(msg, type) {
  toast.textContent = msg;
  toast.className = "toast " + (type || "");
  setTimeout(() => toast.classList.add("hidden"), 2800);
}

// ============ Init ============
if (token) {
  boot();
} else {
  loginScreen.classList.remove("hidden");
}
