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

// Fixed admin identity — must match isAdmin() in firestore.rules exactly.
const ADMIN_EMAIL = "begawanbillykurniawan@gmail.com";

// TEMPORARY placeholder admin password, matching the same local-only
// pattern JessPortal uses — see admin.js for why. Visible in this repo
// on purpose for a closed testing deployment; treat it the same way
// JessPortal's does (change it here AND in firestore.rules' expectations
// if you ever tighten this back up).
window.ADMIN_PASSWORD = "JESSPassword";

// OpenRouter — powers the AI curriculum assistant in admin.js. Same
// exposure caveat as above: this is a static site, so any key placed
// here is visible via view-source to anyone who opens the admin page.
// Placed here at the site owner's explicit instruction for a closed,
// low-usage testing deployment. Revoke and replace before any wider use.
window.GROQ_API_KEY = "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";

// This Firestore database is shared with the separate JESSPORTAL
// (NGO info) site. Every analytics/presence doc JESSEDU writes is
// tagged with SITE_TAG so it stays segregated from portal traffic,
// per firestore.rules (`site in ['portal','edu']`).
const SITE_TAG = "edu";
const ANALYTICS_DOC_ID = "eduTotals";

// Synthetic email domain used to map a bare username to a Firebase
// Auth email/password account (no email field is ever collected).
const USER_EMAIL_DOMAIN = "@users.jess.internal";
