/* ---------------- Firebase Init ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBhONntRE_aRsU0y1YcPZzWud3CBfwH_a8",
  authDomain: "somaptestt.firebaseapp.com",
  databaseURL: "https://somaptestt-default-rtdb.firebaseio.com",
  projectId: "somaptestt",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const listEl = document.getElementById("approvalsList");

/* ---------------- State ---------------- */
let allRequests = {};
let currentTab = "pending";
let searchTerm = "";

/* ---------------- Tabs ---------------- */
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchTerm = e.target.value.toLowerCase().trim();
  render();
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("bg-indigo-600", "text-white");
      b.classList.add("bg-slate-200");
    });
    btn.classList.add("bg-indigo-600", "text-white");
    currentTab = btn.dataset.tab;
    render();
  });
});

/* ---------------- Load Data ---------------- */
db.ref("joinApprovalsPending").on("value", (snap) => {
  allRequests = snap.val() || {};
  updateCounts();
  render();
});

/* ---------------- Render ---------------- */
function render() {
  listEl.innerHTML = "";

  const entries = Object.entries(allRequests).filter(([_, r]) => {
    if (!r) return false;

    // status + approval type check
    if (
      r.status !== currentTab ||
      (r.approvalType && r.approvalType !== "JOIN_REQUEST")
    )
      return false;

    // search by student name
    if (searchTerm) {
      const student = r.studentSnapshot || {};
      const fullName = `${student.firstName || ""} ${
        student.lastName || ""
      }`.toLowerCase();

      return fullName.includes(searchTerm);
    }

    return true;
  });

  if (!entries.length) {
    listEl.innerHTML = `<p class="text-slate-500">No records.</p>`;
    return;
  }

  entries.forEach(([id, r]) => {
    listEl.innerHTML += renderJoinApprovalCard(id, r);
  });
}

/* ---------------- Counts ---------------- */
function updateCounts() {
  const pending = Object.values(allRequests).filter(
    (r) =>
      r &&
      r.status === "pending" &&
      (!r.approvalType || r.approvalType === "JOIN_REQUEST")
  ).length;

  document.getElementById("count-pending").textContent = pending;
}

/* ---------------- Actions ---------------- */
async function approveRequest(id) {
  const ok = await Swal.fire({
    title: "Approve join request?",
    text: "This will open the admission form with details pre-filled.",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Approve & Continue",
  });
  if (!ok.isConfirmed) return;

  const snap = await db.ref(`joinApprovalsPending/${id}`).once("value");
  if (!snap.exists()) return;

  const r = snap.val();

  sessionStorage.setItem(
    "somap_pending_admission",
    JSON.stringify({
      approvalKey: id,
      student: r.studentSnapshot,
      parent: r.parentSnapshot,
      academicYear: r.academicYear,
      referral: r.referral || null,
    })
  );

 

  window.location.href = "./admission.html?from=joinApproval";
}
async function deleteRequest(id) {
  const ok = await Swal.fire({
    title: "Delete this record?",
    text: "This will permanently remove this join request.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Delete",
    confirmButtonColor: "#dc2626",
  });

  if (!ok.isConfirmed) return;

  await db.ref(`joinApprovalsPending/${id}`).remove();
  Swal.fire("Deleted", "Join request removed.", "success");
}


async function rejectRequest(id) {
  const ok = await Swal.fire({
    title: "Reject join request?",
    input: "text",
    inputLabel: "Reason (optional)",
    showCancelButton: true,
    confirmButtonText: "Reject",
  });
  if (!ok.isConfirmed) return;

  await db.ref(`joinApprovalsPending/${id}`).update({
    status: "rejected",
    rejectionReason: ok.value || null,
    rejectedAt: Date.now(),
  });

  Swal.fire("Rejected", "Request rejected.", "success");
}
