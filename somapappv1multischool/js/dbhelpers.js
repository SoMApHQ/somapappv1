// Database helpers scoped to the current school using SOMAP.P
(function attachDbHelpers() {
  const db = window.db || firebase.database();

  function refP(subpath) {
    return db.ref(SOMAP.P(subpath));
  }

  async function readOnce(subpath) {
    const snap = await refP(subpath).get();
    return snap.val();
  }

  function writeTo(subpath, data) {
    return refP(subpath).set(data);
  }

  function updateAt(subpath, data) {
    return db.ref(SOMAP.P(subpath)).update(data);
  }

  function pushTo(subpath, data) {
    return refP(subpath).push(data);
  }

  window.refP = refP;
  window.readOnce = readOnce;
  window.writeTo = writeTo;
  window.updateAt = updateAt;
  window.pushTo = pushTo;
})();
