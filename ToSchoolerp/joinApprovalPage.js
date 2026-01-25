/* ================= Firebase Init ================= */
var firebaseConfig = {
  apiKey: "AIzaSyBhONntRE_aRsU0y1YcPZzWud3CBfwH_a8",
  authDomain: "somaptestt.firebaseapp.com",
  databaseURL: "https://somaptestt-default-rtdb.firebaseio.com",
  projectId: "somaptestt",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

var db = firebase.database();
var listEl = document.getElementById("approvalsList");

/* ================= State ================= */
var allRequests = {};
var currentTab = "pending";
var searchTerm = "";
var parentReferralMap = {};

/* ================= Utils ================= */
function esc(v) {
  return String(v || "").replace(/[&<>"']/g, function (m) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m];
  });
}

/* ================= Tabs ================= */
document.getElementById("searchInput").addEventListener("input", function (e) {
  searchTerm = e.target.value.toLowerCase().trim();
  render();
});

var tabBtns = document.querySelectorAll(".tab-btn");
for (var i = 0; i < tabBtns.length; i++) {
  tabBtns[i].addEventListener("click", function () {
    for (var j = 0; j < tabBtns.length; j++) {
      tabBtns[j].classList.remove("bg-indigo-600", "text-white");
      tabBtns[j].classList.add("bg-slate-200");
    }
    this.classList.add("bg-indigo-600", "text-white");
    currentTab = this.getAttribute("data-tab");
    render();
  });
}

/* ================= Load Parents (Referral Map) ================= */
db.ref("parents").on("value", function (snap) {
  var parents = snap.val() || {};
  parentReferralMap = {};

  for (var pid in parents) {
    if (!parents.hasOwnProperty(pid)) continue;
    var p = parents[pid];
    if (p && p.referralCode) {
      parentReferralMap[p.referralCode] = {
        parentId: pid,
        parentName: p.name || "",
        parentPhone: p.phone || "",
      };
    }
  }

  console.log("Referral Map Loaded", parentReferralMap);
  render();
});

/* ================= Load Join Requests ================= */
db.ref("joinApprovalsPending").on("value", function (snap) {
  allRequests = snap.val() || {};
  console.log("Join Requests Loaded", allRequests);
  updateCounts();
  render();
});

/* ================= Render ================= */
function render() {
  listEl.innerHTML = "";

  var entries = [];
  for (var id in allRequests) {
    if (!allRequests.hasOwnProperty(id)) continue;
    entries.push([id, allRequests[id]]);
  }

  var filtered = [];
  for (var i = 0; i < entries.length; i++) {
    var r = entries[i][1];
    if (!r) continue;

    if (r.status !== currentTab) continue;
    if (r.approvalType && r.approvalType !== "JOIN_REQUEST") continue;

    if (searchTerm) {
      var student = r.studentSnapshot || {};
      var fullName = (student.firstName || "") + " " + (student.lastName || "");
      fullName = fullName.toLowerCase();
      if (fullName.indexOf(searchTerm) === -1) continue;
    }

    filtered.push(entries[i]);
  }

  if (!filtered.length) {
    listEl.innerHTML = '<p class="text-slate-500">No records.</p>';
    return;
  }

  for (var k = 0; k < filtered.length; k++) {
    var id = filtered[k][0];
    var r = filtered[k][1];

    // Deep clone record (avoid Firebase mutation)
    var safeRecord = JSON.parse(JSON.stringify(r));

    // Resolve referral parent name
    if (
      safeRecord.referral &&
      safeRecord.referral.code &&
      parentReferralMap[safeRecord.referral.code]
    ) {
      var p = parentReferralMap[safeRecord.referral.code];
      safeRecord.referral.parentName = p.parentName;
      safeRecord.referral.parentPhone = p.parentPhone;
      safeRecord.referral.parentId = p.parentId;
    }

    listEl.innerHTML += renderJoinApprovalCard(id, safeRecord);
  }
}

/* ================= Counts ================= */
function updateCounts() {
  var pending = 0;
  for (var id in allRequests) {
    if (!allRequests.hasOwnProperty(id)) continue;
    var r = allRequests[id];
    if (
      r &&
      r.status === "pending" &&
      (!r.approvalType || r.approvalType === "JOIN_REQUEST")
    ) {
      pending++;
    }
  }
  document.getElementById("count-pending").textContent = pending;
}

/* ================= Actions ================= */
async function approveRequest(id) {
  var ok = await Swal.fire({
    title: "Approve join request?",
    text: "This will open the admission form with details pre-filled.",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Approve & Continue",
  });

  if (!ok.isConfirmed) return;

  var snap = await db.ref("joinApprovalsPending/" + id).once("value");
  if (!snap.exists()) return;

  var r = snap.val();
  var referralResolved = null;

  // Resolve referral parent again (safe)
  if (r.referral && r.referral.code) {
    var parentSnap = await db
      .ref("parents")
      .orderByChild("referralCode")
      .equalTo(r.referral.code)
      .once("value");

    if (parentSnap.exists()) {
      var data = parentSnap.val();
      var keys = Object.keys(data);
      var pid = keys[0];
      var parent = data[pid];

      referralResolved = {
        code: r.referral.code,
        parentId: pid,
        parentName: parent.name || "",
        parentPhone: parent.phone || "",
      };
    }
  }

  // Store for admission page
  sessionStorage.setItem(
    "somap_pending_admission",
    JSON.stringify({
      approvalKey: id,
      student: {
        firstName: (r.studentSnapshot && r.studentSnapshot.firstName) || "",
        middleName: (r.studentSnapshot && r.studentSnapshot.middleName) || "",
        lastName: (r.studentSnapshot && r.studentSnapshot.lastName) || "",
        classLevel: (r.studentSnapshot && r.studentSnapshot.classLevel) || "",
        gender: (r.studentSnapshot && r.studentSnapshot.gender) || "",
        dob: (r.studentSnapshot && r.studentSnapshot.dob) || "",
      },
      parent: {
        name: (r.parentSnapshot && r.parentSnapshot.name) || "",
        phone: (r.parentSnapshot && r.parentSnapshot.phone) || "",
      },
      academicYear: r.academicYear || "",
      referral: referralResolved || r.referral || null,
    })
  );

  window.location.href = "admission.html?from=joinApproval";
}

/* ================= Delete ================= */
async function deleteRequest(id) {
  var ok = await Swal.fire({
    title: "Delete this record?",
    text: "This will permanently remove this join request.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Delete",
    confirmButtonColor: "#dc2626",
  });

  if (!ok.isConfirmed) return;

  await db.ref("joinApprovalsPending/" + id).remove();
  Swal.fire("Deleted", "Join request removed.", "success");
}

/* ================= Reject ================= */
async function rejectRequest(id) {
  var ok = await Swal.fire({
    title: "Reject join request?",
    input: "text",
    inputLabel: "Reason (optional)",
    showCancelButton: true,
    confirmButtonText: "Reject",
  });

  if (!ok.isConfirmed) return;

  await db.ref("joinApprovalsPending/" + id).update({
    status: "rejected",
    rejectionReason: ok.value || null,
    rejectedAt: Date.now(),
  });

  Swal.fire("Rejected", "Request rejected.", "success");
}

console.log("✅ joinApprovalPage.js loaded successfully");
