. ACTIVE FIREBASE PROJECT

The system is currently running on a single live Firebase project:

Project ID: somaptestt
Region: (Default – not specified, assumed us-central1)

Firebase Services Used:

Authentication: Google Sign‑In (staff), custom parent/worker matching

Realtime Database (RTDB): Core data store for all modules

Firebase Hosting: Not used (deployment is via GitHub Pages)

Firebase Storage: Initialized in app, but NOT used; all file uploads go to Cloudinary
RTDB URL:https://somaptestt-default-rtdb.firebaseio.com
Client Config (from firebase.js / index.html):
apiKey: "AIzaSyBhONntRE_aRsU0y1YcPZzWud3CBfwH_a8"
authDomain: "somaptestt.firebaseapp.com"
databaseURL: "https://somaptestt-default-rtdb.firebaseio.com"
projectId: "somaptestt"
storageBucket: "somaptestt.appspot.com"
messagingSenderId: "105526245138"
appId: "1:105526245138:web:b8e7c0cb82a46e861965cb"
2. CLOUDINARY ENVIRONMENT (LIVE ACCOUNTS + FOLDERS)
Cloudinary is deeply integrated into SoMAp and serves as the file hosting solution for:

Books & learning materials

Worker documents

Worker photos

Preform One photos and books

School ERP admissions

Transport system uploads (bus files, documents)

Graduation galleries

Academic materials (lesson notes, schemes, logs)

Primary Cloud Name Identified:dg7vnrkgd
Upload Endpoints Observed:https://api.cloudinary.com/v1_1/dg7vnrkgd/upload
https://api.cloudinary.com/v1_1/dg7vnrkgd/auto/upload
https://res.cloudinary.com/dg7vnrkgd/image/upload/...
Cloudinary Upload Method:

Unsigned uploads with uploadPreset (no API secret required).

Common Folders / Use‑Cases:

From the search results:

books/ – PDFs, learning content

preformone/books/ – Preform One materials

preformone/photos/ – Student admissions & card photos

preformone – General uploaded content

studentDocs/{studentKey} – Admission documents

graduation/galleries/ – Graduation photos

graduation/expenses/ – Receipts

transport/buses/ – Bus files

workers/contracts/ – Worker paperwork

workers/idcards/ – Generated ID card photos

workers/inventory/ – Storekeeper uploads

academic_materials/ – Lesson content

Cloudinary Presets Identified:

somap_unsigned (default school-wide unsigned preset)

books_unsigned

Module-specific presets in Admission, Preform One, Workers, Transport (exact names vary per page)
3. HOSTING ENVIRONMENT (PRODUCTION DEPLOYMENT)

SoMAp is not hosted on Firebase Hosting. Instead, the front-end is deployed via GitHub Pages, and the app loads Firebase SDK directly from CDN.
github url:https://github.com/SoMApHQ/somapappv1.git