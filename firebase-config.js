/* =========================================================
   firebase-config.js
   Initializes Firebase (compat build, loaded via <script> tags
   in index.html / admin.html — no bundler, works as-is on
   GitHub Pages) and exposes shared `auth` / `db` handles plus
   the fixed admin email and analytics doc id used by app.js
   and admin.js.
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCS4qmv6Cz-63WQSVuhLNYsdpbaUrdOIqI",
  authDomain: "jess-website-9962e.firebaseapp.com",
  projectId: "jess-website-9962e",
  storageBucket: "jess-website-9962e.firebasestorage.app",
  messagingSenderId: "866208405959",
  appId: "1:866208405959:web:f1dec84892ebfc37eaa1e2"
};

firebase.initializeApp(firebaseConfig);

// Shared handles used throughout app.js / admin.js
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Fixed admin identity — must match isAdmin() in firestore.rules exactly.
const ADMIN_EMAIL = "begawanbillykurniawan@gmail.com";

// This Firestore database is shared with the separate JESSPORTAL
// (NGO info) site. Every analytics/presence doc JESSEDU writes is
// tagged with SITE_TAG so it stays segregated from portal traffic,
// per firestore.rules (`site in ['portal','edu']`).
const SITE_TAG = "edu";
const ANALYTICS_DOC_ID = "eduTotals";

// Synthetic email domain used to map a bare username to a Firebase
// Auth email/password account (no email field is ever collected).
const USER_EMAIL_DOMAIN = "@users.jess.internal";
