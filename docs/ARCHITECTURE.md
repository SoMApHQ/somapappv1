the system is a multi‑page application (MPA) with hundreds of modules, organized into functional domains:

Core System Pages: index.html, dashboard.html, staff.html, parent.html, mhasibu.html

Workers System: workershtml/… + workers JS modules

Transport System: transporthtml/… + transport JS modules

Financial Statements Engine: Tojs/financialstatements/…

Graduation System: js/graduation.js, Tostaffhtml/graduation.html

Academic System: Toacademichtml, Bookshtml

Attendance System: Toattendancehtml

ERP System: ToSchoolerp

Shared Utilities: shared/finance_math.js, joining-helpers.js

All pages load their own JS modules separately and pull data directly from RTDB.

Because there is no centralized backend, security rules MUST fully govern every RTDB node.
CORE MODULES
index.html

Responsibilities:

Entry point for login flows (Google staff, parent, worker).

Holds logic for route redirection based on user role.

Performs several RTDB lookups.

RTDB Paths Used:

/users/{emailKey} — staff role lookup

/workers/{workerId} — worker authentication

/devices/{uid}/workerId — worker device tracking

/students/{studentId} — parent matching

/schools/Socrates School Preform one/{year}/students/{id} — Preform One matching

(HIGH PRIORITY: NONE of these paths are protected in existing rules.)

firebase.js

Initializes Firebase and exposes:

window.db = firebase.database()

window.storage = firebase.storage()

RTDB Paths: None directly, but enables every module.

FINANCE MODULES
finance.html + financeplans.js + finance_plans.js

Responsibilities:

School finance plans, fee plans, structure of payments.

Likely interacts with: /finance, /plans, /payments, /fees.

RTDB Paths Observed or Expected:

/payments/{id}

/expenses/{id}

/balances/{student}

/finance/plans/...

GRADUATION MODULES
js/graduation.js
Tostaffhtml/graduation.html, gradgalleries.html, gradexpenses.html, gradcertificates.html

Responsibilities:

Entire graduation subsystem.

Upload galleries, record expenses, generate certificates.

RTDB Paths: (MATCH EXACTLY WITH RULES)

/graduation/{year}/meta

/graduation/{year}/students/{id}

/graduation/{year}/payments/{id}

/graduation/{year}/expenses/{id}

/graduation/{year}/certificates/{student}

/graduation/{year}/galleries/{photo}

(GOOD: These paths are covered by your current rules.)

WORKERS SYSTEM
workershtml/ (20+ workforce pages)
workershtml/modules/ (contracts, payroll, inventory, penalties, UI, validation)

Responsibilities:

School HR, payroll, tasks, penalties, leaves, ID cards, certificates, contracts, storekeeper duties.

RTDB Paths Used: Examples from worker-login logic already seen:

/workers/{workerId}/profile/fullNameUpper

/workers/{workerId}/profile/phone

/workers/{workerId}/contracts/...

/workers/settings (from seed scripts)

/devices/{uid}/workerId

/tasks/{workerId} (likely in Toworkertaskshtml)

Security Gap: NONE OF THESE nodes are protected by your RTDB rules.

TRANSPORT SYSTEM
transporthtml/ (20+ HTML pages)
transporthtml/modules/

Responsibilities:

Transport buses, routes, drivers, payments, attendance, maintenance, notifications.

Real‑time GPS logs, auto‑tracker scripts.

RTDB Paths Expected:

/transport/routes/{id}

/transport/drivers/{id}

/transport/buses/{id}

/transport/attendance/{busId}/{date}/{studentId}

/transport/payments/{transactionId}

/transport/maintenance/{recordId}

/transport/incidents/{incidentId}

Security Gap: NONE of these nodes are protected in current rules.

ACADEMIC SYSTEM
Toacademichtml/
js/modules/grading.js, subjects.js

Responsibilities:

Scoresheet generation

Report form computation

Subject management

Expected RTDB Paths:

/academics/subjects/{subjectId}

/academics/scores/{class}/{exam}/{studentId}

/academics/classes/{id}

Security Gap: Unprotected.

ATTENDANCE SYSTEM
Toattendancehtml/

Responsibilities:

Per‑student, per‑class, and per‑day attendance

Expected RTDB Paths:

/attendance/{date}/{studentId}

/classAttendance/{class}/{date}/{studentId}

Security Gap: Unprotected.

ERP / SCHOOL MANAGEMENT
ToSchoolerp/

Responsibilities:

Admissions

Student lists

Discipline

Application processing

Expected RTDB Paths:

/erp/admissions/{id}

/erp/students/{id}

/erp/applications/{id}

/erp/discipline/{id}

Security Gap: Unprotected.

PREFORM ONE SYSTEM
preformonehtml/

Pages include:

Admissions, attendance, books, finance, academic results, report forms, receipts

Expected RTDB Paths:

/schools/Socrates School Preform one/{year}/students/{id}

/schools/.../finance/...

/schools/.../attendance/...

Security Gap: Unprotected.
list that must be covered
/graduation/{year}/...
/users/{emailKey}
/workers/{workerId}
/devices/{uid}
/students/{studentId}
/schools/{schoolName}/{year}/students/{id}
/transport/... (many subtrees)
/erp/... (admissions, discipline, applications)
/attendance/...
/classAttendance/...
/academics/...
/finance/... (payments, balances, plans)
/tasks/{workerId}/...
current rules only cover /graduation/{year}/...
/users/{emailKey}
/workers/{workerId}
/devices/{uid}
/students/{studentId}
/schools/{schoolName}/{year}/students/{id}
/transport/... (many subtrees)
/erp/... (admissions, discipline, applications)
/attendance/...
/classAttendance/...
/academics/...
/finance/... (payments, balances, plans)
/tasks/{workerId}/...