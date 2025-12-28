// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyBhONntRE_aRsU0y1YcPZzWud3CBfwH_a8",
  authDomain: "somapv2i.com",
  databaseURL: "https://somaptestt-default-rtdb.firebaseio.com",
  projectId: "somaptestt",
  storageBucket: "somaptestt.appspot.com",
  messagingSenderId: "105526245138",
  appId: "1:105526245138:web:b8e7c0cb82a46e861965cb",
};

// --- Initialize Firebase once ---
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// --- Export handles globally so HTML pages can use them ---
const db = firebase.database();
const storage = firebase.storage ? firebase.storage() : null;

window.db = db;
window.storage = storage;

console.log("✅ Firebase initialized, DB ready:", db);
