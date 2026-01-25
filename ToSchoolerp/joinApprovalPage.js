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
let parentReferralMap = {};


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
db.ref("parents").on("value", snap => {
  const parents = snap.val() || {};
  parentReferralMap = {};

  Object.values(parents).forEach(p => {
    if (p.referralCode) {
      parentReferralMap[p.referralCode] = {
        parentId: p.id || null,
        parentName: p.name || "",
        parentPhone: p.phone || ""
      };
    }
  });

  render(); // 
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
  if (r.referral?.code && parentReferralMap[r.referral.code]) {
    r.referral = {
      ...r.referral,
      ...parentReferralMap[r.referral.code]
    };
  }

  listEl.innerHTML += renderJoinApprovalCard(id, r);
});


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
  let referralResolved = null;

if (r.referral?.code) {
  const parentSnap = await db.ref("parents")
    .orderByChild("referralCode")
    .equalTo(r.referral.code)
    .once("value");

  if (parentSnap.exists()) {
    const parentId = Object.keys(parentSnap.val())[0];
    const parent = parentSnap.val()[parentId];

    referralResolved = {
      code: r.referral.code,
      parentId,
      parentName: parent.name || "",
      parentPhone: parent.phone || ""
    };
  }
}


 sessionStorage.setItem(
  "somap_pending_admission",
  JSON.stringify({
    approvalKey: id,

    student: {
      firstName: r.studentSnapshot?.firstName || "",
      middleName: r.studentSnapshot?.middleName || "",
      lastName: r.studentSnapshot?.lastName || "",
      classLevel: r.studentSnapshot?.classLevel || "",
      gender: r.studentSnapshot?.gender || "",
      dob: r.studentSnapshot?.dob || "",
    },

    parent: {
      name: r.parentSnapshot?.name || "",
      phone: r.parentSnapshot?.phone || "",
    },

    academicYear: r.academicYear || "",
    referral: r.referral || null,
  })
);

 

  window.location.href = "admission.html?from=joinApproval";
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
