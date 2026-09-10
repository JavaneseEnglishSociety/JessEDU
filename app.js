/* Translate button is wired up FIRST, before any Firebase code below,
   so it keeps working even if Firebase fails to initialize (network
   issue, firewall, ad-blocker). An uncaught error partway through this
   file used to silently stop every later top-level statement from
   running at all, including features with nothing to do with Firebase. */
/* ---------------------------------------------------------
   Translate button (English -> Indonesian, obvious floating FAB)

   Uses Google Translate's public web-client endpoint rather than the
   official Cloud Translation API, since the official API needs a
   billing account and a secret key -- and a secret key can't stay
   secret in a static site's own JavaScript anyway (anyone can
   view-source it). This endpoint needs no key and works from any
   browser. It is not an officially supported public API, so if
   Google ever rate-limits or changes it, translation just silently
   stops working rather than breaking the page: every call is
   wrapped so a failure leaves the original English text in place.
   --------------------------------------------------------- */
const translateCache = new Map();
const translateInFlight = new Map();
let pageIsTranslated = false;

async function translateOneString(text) {
  if (!text || !text.trim()) return text;
  if (translateCache.has(text)) return translateCache.get(text);
  if (translateInFlight.has(text)) return translateInFlight.get(text);
  const promise = (async () => {
    try {
      const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=id&dt=t&q=" + encodeURIComponent(text);
      const res = await fetch(url);
      if (!res.ok) throw new Error("translate failed: " + res.status);
      const data = await res.json();
      const translated = (data[0] || []).map((chunk) => chunk[0]).join("");
      const finalText = translated || text;
      translateCache.set(text, finalText);
      return finalText;
    } catch (e) {
      console.warn("JessEDU: translation failed for one piece of text; leaving it in English.", e);
      return text;
    } finally {
      translateInFlight.delete(text);
    }
  })();
  translateInFlight.set(text, promise);
  return promise;
}

// Walks every visible text node inside a container, stashes the
// original English on the node itself (so toggling back needs no
// re-fetch), and swaps in the Indonesian version once it resolves.
function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement && node.parentElement.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "INPUT" || tag === "TEXTAREA") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

async function translateVisibleArea() {
  // Previously this only ever looked inside #dashboard -- meaning
  // clicking the button on the landing page (the very first thing
  // anyone sees, before logging in) translated an empty, hidden
  // container while doing nothing to what was actually on screen.
  // This now picks whichever top-level view is actually visible.
  const candidateRoots = ["landingView", "authView", "dashboard"]
    .map((id) => document.getElementById(id))
    .filter((el) => el && !el.hidden);
  const containers = [
    ...candidateRoots,
    ...document.querySelectorAll("#modalHost .modal-panel")
  ].filter(Boolean);

  const fab = document.getElementById("translateFab");
  const label = document.getElementById("translateFabLabel");
  fab.classList.add("is-busy");

  if (pageIsTranslated) {
    // Toggling back to English needs no network call at all -- every
    // translated node already has its original English text stashed
    // in a data attribute from the pass that translated it.
    containers.forEach((root) => {
      collectTextNodes(root).forEach((node) => {
        const original = node.__jessOriginal;
        if (original !== undefined) node.nodeValue = original;
      });
    });
    pageIsTranslated = false;
    label.textContent = "EN → ID";
    fab.classList.remove("is-busy");
    return;
  }

  const jobs = [];
  let successCount = 0;
  containers.forEach((root) => {
    collectTextNodes(root).forEach((node) => {
      if (node.__jessOriginal === undefined) node.__jessOriginal = node.nodeValue;
      const original = node.__jessOriginal;
      jobs.push(
        translateOneString(original).then((translated) => {
          // Guard against the node having been re-rendered away, or the
          // user having toggled back to English before this resolved.
          if (node.isConnected) node.nodeValue = translated;
          if (translated !== original) successCount++;
        })
      );
    });
  });

  await Promise.all(jobs);
  fab.classList.remove("is-busy");

  // Previously the button always flipped to "ID -> EN" (implying it
  // worked) no matter what, even if EVERY single translation silently
  // failed and fell back to the original English text -- which happens
  // whenever the network to Google Translate's endpoint is blocked or
  // unreachable. The page would stay in English, but the button would
  // insist it was now showing Indonesian, with zero indication anything
  // went wrong. That is exactly what "the button doesn't work" looks
  // like from the outside, even though each failure was already being
  // caught correctly one level down. Now: only claim success if at
  // least one string actually changed, and say so plainly if none did.
  if (successCount === 0 && jobs.length > 0) {
    showToast("Couldn't reach the translation service right now. Check your connection and try again.", "error");
    return;
  }
  pageIsTranslated = true;
  label.textContent = "ID → EN";
}

document.getElementById("translateFab").addEventListener("click", () => {
  translateVisibleArea();
});

/* =========================================================
   app.js — JESS public site logic
   ========================================================= */

/* ---------------------------------------------------------
   0. Shared error handling + toasts
   --------------------------------------------------------- */
function describeFirebaseError(err) {
  const code = (err && err.code) || "";
  if (code === "unavailable" || code === "auth/network-request-failed")
    return "You're offline, or the server isn't reachable right now.";
  if (code === "permission-denied")
    return "That action isn't allowed for your account.";
  if (code === "not-found") return "That couldn't be found.";
  if (code === "already-exists" || code === "auth/email-already-in-use")
    return "That's already taken — try something else.";
  if (["auth/wrong-password", "auth/user-not-found", "auth/invalid-credential"].includes(code))
    return "Incorrect username or password.";
  if (code === "auth/too-many-requests") return "Too many attempts — wait a moment.";
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (err && err.message === "username-taken") return "That username is already taken.";
  return (err && err.message) || "Something went wrong. Please try again.";
}

function showToast(message, type) {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = "toast" + (type ? " toast-" + type : "");
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function renderAlert(hostEl, message, opts) {
  opts = opts || {};
  if (!message) { hostEl.innerHTML = ""; return; }
  const type = opts.type || "error";
  hostEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "alert alert-" + type;
  const span = document.createElement("span");
  span.textContent = message;
  div.appendChild(span);
  if (opts.onRetry) {
    const btn = document.createElement("button");
    btn.className = "retry-btn";
    btn.type = "button";
    btn.textContent = "Retry";
    btn.addEventListener("click", opts.onRetry);
    div.appendChild(btn);
  }
  hostEl.appendChild(div);
}

/* ---------------------------------------------------------
   1. View switching — three mutually exclusive full-page
      views (see build notes §4). Never stacked overlays.
   --------------------------------------------------------- */
const VIEWS = ["landingNav", "landingView", "authView", "dashboard"];

function showView(name) {
  // Force-hide every view first — don't rely on the opening code
  // path also being the one that closes prior views.
  document.getElementById("landingNav").hidden = name !== "landing";
  document.getElementById("landingView").hidden = name !== "landing";
  document.getElementById("authView").hidden = name !== "auth";
  document.getElementById("dashboard").hidden = name !== "dashboard";
  window.scrollTo(0, 0);
}

document.querySelectorAll("[data-nav='landing']").forEach(el => {
  el.addEventListener("click", (e) => { e.preventDefault(); showView("landing"); });
});

document.querySelectorAll("[data-open-auth]").forEach(el => {
  el.addEventListener("click", () => {
    showView("auth");
    setAuthTab(el.getAttribute("data-open-auth"));
  });
});

/* ---------------------------------------------------------
   2. Password masking without a real type="password" field
      (WebKit AutoFill workaround — see build notes §4)
   --------------------------------------------------------- */
(function setupPasswordMasking() {
  if (!window.CSS || !CSS.supports("-webkit-text-security", "disc")) {
    document.querySelectorAll("input.pw-mask").forEach(el => { el.type = "password"; });
  }
})();

/* ---------------------------------------------------------
   3. Auth view tab switching
   --------------------------------------------------------- */
function setAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach(t => {
    t.classList.toggle("active", t.getAttribute("data-auth-tab") === tab);
  });
  document.getElementById("signupForm").hidden = tab !== "signup";
  document.getElementById("loginForm").hidden = tab !== "login";
  renderAlert(document.getElementById("authAlert"), "");
}
document.querySelectorAll("[data-auth-tab]").forEach(el => {
  el.addEventListener("click", () => setAuthTab(el.getAttribute("data-auth-tab")));
});

/* ---------------------------------------------------------
   4. Auth flows
   --------------------------------------------------------- */
function setBtnLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner" aria-hidden="true"></span> <span>Please wait…</span>'
    : '<span class="btn-label">' + label + "</span>";
}

async function signUp(username, password) {
  const email = username.toLowerCase() + USER_EMAIL_DOMAIN;
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  const usernameRef = db.collection("usernames").doc(username.toLowerCase());
  const profileRef = db.collection("users").doc(cred.user.uid);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(usernameRef);
      if (existing.exists) throw new Error("username-taken");
      tx.set(usernameRef, { uid: cred.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      tx.set(profileRef, {
        username: username, displayName: username, xp: 0, level: 1, jessPoints: 0,
        streak: 0, lastActiveDate: null, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  } catch (err) {
    await cred.user.delete();
    throw err;
  }
}

function logIn(username, password) {
  const email = username.toLowerCase() + USER_EMAIL_DOMAIN;
  return auth.signInWithEmailAndPassword(email, password);
}

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alertHost = document.getElementById("authAlert");
  renderAlert(alertHost, "");
  const username = document.getElementById("suUsername").value.trim();
  const password = document.getElementById("authSecret1").value;
  const btn = document.getElementById("signupSubmitBtn");
  setBtnLoading(btn, true);
  try {
    clearGuestState();
    await signUp(username, password);
    showToast("Welcome to JESS, " + username + "!", "success");
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err));
  } finally {
    setBtnLoading(btn, false, "Create my account");
  }
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alertHost = document.getElementById("authAlert");
  renderAlert(alertHost, "");
  const username = document.getElementById("liUsername").value.trim();
  const password = document.getElementById("authSecret2").value;
  const btn = document.getElementById("loginSubmitBtn");
  setBtnLoading(btn, true);
  try {
    clearGuestState();
    await logIn(username, password);
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err), {
      onRetry: () => document.getElementById("loginForm").dispatchEvent(new Event("submit"))
    });
  } finally {
    setBtnLoading(btn, false, "Log in");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await auth.signOut();
    showView("landing");
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
});

/* ---------------------------------------------------------
   5. Guest mode — zero data collected, localStorage only
   --------------------------------------------------------- */
const GUEST_KEY = "jessGuestState";

function defaultGuestState() {
  return { xp: 0, jessPoints: 0, level: 1, streak: 0, lastActiveDate: null, completed: {} };
}
function getGuestState() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? JSON.parse(raw) : defaultGuestState();
  } catch (e) { return defaultGuestState(); }
}
function setGuestState(state) {
  localStorage.setItem(GUEST_KEY, JSON.stringify(state));
}
function clearGuestState() {
  localStorage.removeItem(GUEST_KEY);
}
function isGuestActive() {
  return !auth.currentUser && localStorage.getItem(GUEST_KEY) !== null;
}

function enterGuestMode() {
  if (!localStorage.getItem(GUEST_KEY)) setGuestState(defaultGuestState());
  showView("dashboard");
  document.getElementById("guestBanner").hidden = false;
  loadDashboard();
}
document.getElementById("guestCtaBtn").addEventListener("click", enterGuestMode);
document.getElementById("guestFromAuthBtn").addEventListener("click", enterGuestMode);

/* ---------------------------------------------------------
   6. Level/XP math
   --------------------------------------------------------- */
const XP_PER_ACTIVITY = 10; // fallback default for activities with no configured xpReward
const JESS_POINTS_PER_ACTIVITY = 5; // fallback default; normally = round(xpReward / 2)

function levelForXp(xp) {
  let level = 1;
  while ((level + 1) * level * 25 <= xp) level++;
  return level;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function nextStreak(current, lastActiveDate) {
  const today = todayStr();
  if (lastActiveDate === today) return current;
  if (lastActiveDate === yesterdayStr()) return current + 1;
  return 1;
}

// Derives the JESS Points reward from an activity's XP reward (half,
// rounded, minimum 1) so admins only ever have to set one number.
function pointsForXp(xp) { return Math.max(1, Math.round(xp / 2)); }

/* ---------------------------------------------------------
   7. Completing an activity
   --------------------------------------------------------- */
// Turns a fixed configured reward into a small random range around it
// (roughly ±20%, always at least 1 more or less than the base so a
// repeat action doesn't always feel identical) rather than the exact
// same number every single time. The average across many completions
// still lands close to what the admin configured -- this adds variety,
// it doesn't let anyone farm more XP than intended.
function randomizeXp(baseXp) {
  const variance = Math.max(1, Math.round(baseXp * 0.2));
  const roll = baseXp + Math.floor(Math.random() * (variance * 2 + 1)) - variance;
  return Math.max(1, roll);
}

async function completeActivity(activityId, scoreFraction, xpReward, itemTitle) {
  // Clamp to the same ceiling firestore.rules enforces server-side
  // (200 XP / 100 points per completion) so a misconfigured reward
  // never gets silently rejected by the write rule.
  const baseXp = Math.max(1, Math.min(200, xpReward != null ? xpReward : XP_PER_ACTIVITY));
  const xp = Math.max(1, Math.min(200, randomizeXp(baseXp)));
  const points = Math.max(1, Math.min(100, pointsForXp(xp)));

  if (auth.currentUser) {
    const uid = auth.currentUser.uid;
    const progressRef = db.collection("users").doc(uid).collection("progress").doc(activityId);
    const profileRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const [progressSnap, profileSnap] = await Promise.all([tx.get(progressRef), tx.get(profileRef)]);
      if (progressSnap.exists) throw Object.assign(new Error("Already completed."), { code: "already-exists" });
      if (!profileSnap.exists) throw Object.assign(new Error("This account has no learner profile — sign up as a learner to earn XP (the admin account itself doesn't track XP)."), { code: "not-found" });
      const current = profileSnap.data();
      const newXp = current.xp + xp;
      tx.set(progressRef, {
        completedAt: firebase.firestore.FieldValue.serverTimestamp(),
        score: scoreFraction, xpEarned: xp, pointsEarned: points,
      });
      tx.update(profileRef, {
        xp: newXp,
        level: levelForXp(newXp),
        jessPoints: current.jessPoints + points,
        streak: nextStreak(current.streak, current.lastActiveDate),
        lastActiveDate: todayStr(),
      });
    });
  } else {
    const state = getGuestState();
    if (state.completed[activityId]) {
      const err = new Error("Already completed."); err.code = "already-exists"; throw err;
    }
    state.completed[activityId] = { completedAt: Date.now(), score: scoreFraction, xpEarned: xp, pointsEarned: points, title: itemTitle || "" };
    state.xp += xp;
    state.jessPoints += points;
    state.level = levelForXp(state.xp);
    state.streak = nextStreak(state.streak, state.lastActiveDate);
    state.lastActiveDate = todayStr();
    setGuestState(state);
  }
  // The actual awarded amounts, post-randomization -- callers must use
  // THESE for any on-screen message, not whatever base xpReward they
  // passed in, or the toast would show a different number than what
  // actually got saved.
  return { xp, points };
}

/* ---------------------------------------------------------
   8. Data loading — levels & activities (where-only, then
      sort client-side; see build notes §5 composite-index note)
   --------------------------------------------------------- */
async function fetchPublishedLevels() {
  const snap = await db.collection("levels").where("published", "==", true).get();
  const levels = [];
  snap.forEach(doc => levels.push({ id: doc.id, ...doc.data() }));
  levels.sort((a, b) => (a.order || 0) - (b.order || 0));
  return levels;
}
async function fetchPublishedActivitiesForLevel(levelId) {
  const snap = await db.collection("activities")
    .where("published", "==", true)
    .where("levelId", "==", levelId)
    .get();
  const acts = [];
  snap.forEach(doc => acts.push({ id: doc.id, ...doc.data() }));
  acts.sort((a, b) => (a.order || 0) - (b.order || 0));
  return acts;
}

function getCompletedSet() {
  if (auth.currentUser) return window.__jessProgressCache || {};
  return getGuestState().completed || {};
}

/* ---------------------------------------------------------
   9. Dashboard rendering
   --------------------------------------------------------- */
let __allLevels = [];
let __activitiesByLevel = {};

async function loadDashboard() {
  const host = document.getElementById("levelPathHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading your path…</div>';
  const alertHost = document.getElementById("dashAlertHost");
  renderAlert(alertHost, "");

  try {
    updateSidebarStats();
    __allLevels = await fetchPublishedLevels();

    if (auth.currentUser) {
      const progSnap = await db.collection("users").doc(auth.currentUser.uid).collection("progress").get();
      const cache = {};
      progSnap.forEach(d => cache[d.id] = d.data());
      window.__jessProgressCache = cache;
    }

    __activitiesByLevel = {};
    for (const lvl of __allLevels) {
      __activitiesByLevel[lvl.id] = await fetchPublishedActivitiesForLevel(lvl.id);
    }

    renderLevelPath();
    maybeShowPlacementPrompt();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(alertHost, describeFirebaseError(err), { onRetry: loadDashboard });
  }
}

function updateSidebarStats() {
  let profile;
  if (auth.currentUser) {
    profile = window.__jessProfileCache || { xp: 0, jessPoints: 0, level: 1, streak: 0, displayName: auth.currentUser.uid };
  } else {
    const g = getGuestState();
    profile = { xp: g.xp, jessPoints: g.jessPoints, level: g.level, streak: g.streak, displayName: "Guest learner" };
  }
  document.getElementById("dashUserName").textContent = profile.displayName || profile.username || "Learner";
  document.getElementById("dashXpPill").textContent = profile.xp + " XP";
  document.getElementById("dashPointsPill").textContent = profile.jessPoints + " JP";
  document.getElementById("dashLevelPill").textContent = "Lvl " + profile.level;
  document.getElementById("dashStreakLabel").innerHTML = '<span class="streak-flame">🔥</span> ' + profile.streak + " day streak";

  document.getElementById("progXp").textContent = profile.xp;
  document.getElementById("progPoints").textContent = profile.jessPoints;
  document.getElementById("progLevel").textContent = profile.level;
  document.getElementById("progStreak").textContent = profile.streak;
}

function isLevelActsComplete(acts, completed) {
  const required = acts.filter(a => a.required !== false);
  // A level with activities but where none are marked required still
  // needs at least the full set done, so optional-only levels aren't
  // trivially "complete" with zero engagement.
  const toCheck = required.length > 0 ? required : acts;
  return toCheck.length > 0 && toCheck.every(a => completed[a.id]);
}

function levelStateFor(index) {
  const lvl = __allLevels[index];
  const acts = __activitiesByLevel[lvl.id] || [];
  const completed = getCompletedSet();
  const isComplete = isLevelActsComplete(acts, completed);

  if (index === 0) return isComplete ? "complete" : "available";
  const prevLvl = __allLevels[index - 1];
  const prevActs = __activitiesByLevel[prevLvl.id] || [];
  const prevComplete = isLevelActsComplete(prevActs, completed);
  if (!prevComplete) return "locked";
  return isComplete ? "complete" : "available";
}

const ACTIVITY_TYPE_META = {
  quiz: { label: "Quiz", color: "var(--leaf)", icon: "📝" },
  match: { label: "Word match", color: "var(--sky)", icon: "🔤" },
  fill: { label: "Fill in the blank", color: "var(--mango)", icon: "✏️" },
  lesson: { label: "Lesson", color: "var(--leaf-dark)", icon: "📘" },
  flashcards: { label: "Flashcards", color: "var(--sky)", icon: "🗂️" },
  listening: { label: "Listening", color: "var(--mango)", icon: "🎧" },
  reading: { label: "Reading", color: "var(--leaf)", icon: "📖" },
  sentenceBuilder: { label: "Sentence builder", color: "var(--coral)", icon: "🧩" },
  memoryFlip: { label: "Memory flip", color: "var(--sky)", icon: "🃏" },
  wordScramble: { label: "Word scramble", color: "var(--mango)", icon: "🔀" },
  speedRound: { label: "Speed round", color: "var(--coral)", icon: "⚡" },
  picturePop: { label: "Picture pop", color: "var(--leaf)", icon: "🎯" },
  oddOneOut: { label: "Odd one out", color: "var(--coral)", icon: "🔍" },
  sentenceOrder: { label: "Sentence order", color: "var(--sky)", icon: "↕️" },
  listenType: { label: "Listen and type", color: "var(--mango)", icon: "🎙️" },
  categorize: { label: "Categorize", color: "var(--leaf)", icon: "🗃️" },
};
const DEFAULT_XP_BY_TYPE = { quiz: 20, match: 15, fill: 15, lesson: 25, flashcards: 15, listening: 25, reading: 25, sentenceBuilder: 20, memoryFlip: 20, wordScramble: 15, speedRound: 25, picturePop: 15, oddOneOut: 15, sentenceOrder: 20, listenType: 20, categorize: 15 };


function renderLevelPath() {
  const host = document.getElementById("levelPathHost");
  host.innerHTML = "";

  if (__allLevels.length === 0) {
    host.innerHTML = '<div class="empty-state"><h3>No levels published yet</h3><p>Check back soon — the JESS team is preparing your learning path.</p></div>';
    return;
  }

  const track = document.createElement("div");
  track.className = "level-path-track";

  const completed = getCompletedSet();

  __allLevels.forEach((lvl, i) => {
    const state = levelStateFor(i);
    const acts = __activitiesByLevel[lvl.id] || [];

    const row = document.createElement("div");
    row.className = "level-node-row";

    const node = document.createElement("div");
    node.className = "level-node " + state;
    node.style.animationDelay = (i * 80) + "ms";
    node.textContent = state === "complete" ? "✓" : (i + 1);
    row.appendChild(node);

    const card = document.createElement("div");
    card.className = "level-node-card" + (state === "locked" ? " locked" : "");
    const doneCount = acts.filter(a => completed[a.id]).length;

    card.innerHTML =
      '<div><h4>' + escapeHtml(lvl.title || "Level " + (i + 1)) + '</h4>' +
      '<div class="rte-render">' + sanitizeRichHtml(lvl.description || "") + '</div>' +
      (acts.length ? '<p style="margin-top:4px;">' + doneCount + "/" + acts.length + " activities</p>" : "") + '</div>';

    if (state !== "locked" && acts.length > 0) {
      const chipRow = document.createElement("div");
      chipRow.className = "activity-chip-row";
      acts.forEach((act, actIndex) => {
        const chip = document.createElement("button");
        const done = !!completed[act.id];
        // Within-level sequencing: this was the actual remaining gap.
        // Levels already locked each other, and the standalone Lesson
        // Library got the same treatment, but every activity INSIDE one
        // unlocked level was always equally clickable regardless of
        // order -- activity 3 was reachable before 1 and 2 were done.
        // Optional activities don't block the ones after them, since
        // they're explicitly marked as not required.
        const prevRequired = acts.slice(0, actIndex).filter((a) => a.required !== false);
        const locked = prevRequired.length > 0 && !prevRequired.every((a) => completed[a.id]);
        chip.className = "activity-chip" + (done ? " done" : "") + (locked ? " locked" : "");
        chip.type = "button";
        const meta = ACTIVITY_TYPE_META[act.type] || { label: act.type, color: "var(--ink-soft)", icon: "•" };
        const isOptional = act.required === false;
        chip.innerHTML = (locked ? "🔒 " : ('<span class="type-dot" style="background:' + meta.color + '"></span>')) +
          (locked ? "" : (meta.icon || "") + " ") + escapeHtml(act.title) + (isOptional ? ' <span style="opacity:0.6; font-size:0.75em;">(optional)</span>' : "") + (done ? " ✓" : "");
        chip.addEventListener("click", () => {
          if (locked) {
            const blocker = prevRequired.find((a) => !completed[a.id]);
            showToast("Complete \"" + (blocker ? blocker.title : "the previous activity") + "\" first to unlock this one.", "info");
            return;
          }
          openActivityModal(act);
        });
        chipRow.appendChild(chip);
      });
      card.appendChild(chipRow);
    } else if (state !== "locked") {
      const p = document.createElement("p");
      p.style.marginTop = "8px";
      p.textContent = "No activities published in this level yet.";
      card.appendChild(p);
    } else {
      // Previously a locked level rendered nothing at all here: no
      // message, no click handler, nothing -- clicking it silently did
      // absolutely nothing, with no indication to the learner of why or
      // what to do about it. Now it clearly says it's locked, and
      // clicking it names the specific level standing in the way.
      const lockNote = document.createElement("p");
      lockNote.style.marginTop = "8px";
      lockNote.style.cursor = "pointer";
      lockNote.innerHTML = "🔒 Locked — tap to see what's needed";
      const prevLvl = __allLevels[i - 1];
      const prevTitle = prevLvl ? (prevLvl.title || "the previous level") : "the previous level";
      card.style.cursor = "pointer";
      const notifyLocked = () => {
        showToast("Complete \"" + prevTitle + "\" first to unlock this level.", "info");
      };
      card.addEventListener("click", notifyLocked);
      lockNote.addEventListener("click", (e) => { e.stopPropagation(); notifyLocked(); });
      card.appendChild(lockNote);
    }

    row.appendChild(card);
    track.appendChild(row);
  });

  host.appendChild(track);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, "&quot;"); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------
   9b. Media Library (student view)
   --------------------------------------------------------- */
const MEDIA_CATEGORIES = ["Images", "Videos", "Audio", "Presentations", "Worksheets", "Icons", "Other"];

function sanitizeRichHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  div.querySelectorAll("script, style, iframe, object, embed").forEach(el => el.remove());
  div.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name) ||
          ((attr.name === "href" || attr.name === "src") && /^javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return div.innerHTML;
}

function parseMediaLink(url) {
  const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
  if (youtubeMatch) return { type: "youtube", embedUrl: "https://www.youtube.com/embed/" + youtubeMatch[1], icon: "🎥" };
  const driveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/);
  if (driveMatch) return { type: "drive", embedUrl: "https://drive.google.com/file/d/" + driveMatch[1] + "/preview", icon: "📄" };
  if (/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url)) return { type: "image", embedUrl: url, icon: "🖼️" };
  if (/\.pdf(\?.*)?$/i.test(url)) return { type: "pdf", embedUrl: url, icon: "📄" };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return { type: "video", embedUrl: url, icon: "🎥" };
  if (/\.(mp3|wav)(\?.*)?$/i.test(url)) return { type: "audio", embedUrl: url, icon: "🎧" };
  return { type: "link", embedUrl: url, icon: "🔗" };
}

let __allMediaCache = [];
let __mediaCatFilter = "all";

async function loadMediaLibrary() {
  const host = document.getElementById("mediaGridHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading resources…</div>';
  try {
    const snap = await db.collection("media").where("published", "==", true).get();
    __allMediaCache = [];
    snap.forEach(doc => __allMediaCache.push({ id: doc.id, ...doc.data() }));
    renderMediaTabs();
    renderMediaGrid();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("dashAlertHost"), describeFirebaseError(err), { onRetry: loadMediaLibrary });
  }
}

function renderMediaTabs() {
  const host = document.getElementById("mediaCatTabs");
  const cats = ["all"].concat(MEDIA_CATEGORIES);
  host.innerHTML = cats.map(c =>
    '<button type="button" class="media-cat-tab ' + (c === __mediaCatFilter ? "active" : "") + '" data-cat="' + c + '">' + (c === "all" ? "All" : c) + '</button>'
  ).join("");
  host.querySelectorAll("[data-cat]").forEach(btn =>
    btn.addEventListener("click", () => { __mediaCatFilter = btn.getAttribute("data-cat"); renderMediaTabs(); renderMediaGrid(); })
  );
}

function renderMediaGrid() {
  const host = document.getElementById("mediaGridHost");
  const search = (document.getElementById("mediaSearchInput").value || "").toLowerCase();
  const items = __allMediaCache.filter(m =>
    (__mediaCatFilter === "all" || m.category === __mediaCatFilter) &&
    (!search || m.title.toLowerCase().includes(search) || (m.tags || []).join(" ").toLowerCase().includes(search))
  );
  if (!items.length) { host.innerHTML = '<div class="empty-state"><h3>No resources found</h3></div>'; return; }
  host.innerHTML = '<div class="media-grid">' + items.map(m => {
    const link = parseMediaLink(m.url || "");
    return '<div class="media-card" data-open-media="' + m.id + '">' +
      '<div class="media-thumb">' + (link.type === "image" ? '<img src="' + escapeHtml(m.url) + '" alt="">' : '<span>' + link.icon + '</span>') + '</div>' +
      '<div class="media-info"><h4>' + escapeHtml(m.title) + '</h4><span class="media-cat-label">' + escapeHtml(m.category) + '</span></div></div>';
  }).join("") + '</div>';
  host.querySelectorAll("[data-open-media]").forEach(card =>
    card.addEventListener("click", () => openMediaViewer(items.find(m => m.id === card.getAttribute("data-open-media"))))
  );
}

document.getElementById("mediaSearchInput").addEventListener("input", renderMediaGrid);

function openMediaViewer(item) {
  const link = parseMediaLink(item.url || "");
  let bodyHtml = '<p class="eyebrow">' + escapeHtml(item.category) + '</p><h3 style="margin-bottom:14px;">' + escapeHtml(item.title) + '</h3>';
  if (link.type === "image") {
    bodyHtml += '<img src="' + escapeHtml(item.url) + '" style="width:100%; border-radius:12px;" alt="">';
  } else if (link.type === "video") {
    bodyHtml += '<video src="' + escapeHtml(item.url) + '" controls style="width:100%; border-radius:12px;"></video>';
  } else if (link.type === "audio") {
    bodyHtml += '<audio src="' + escapeHtml(item.url) + '" controls style="width:100%;"></audio>';
  } else if (link.type === "pdf" || link.type === "drive" || link.type === "youtube") {
    bodyHtml += '<iframe class="media-viewer-frame" src="' + escapeHtml(link.embedUrl) + '" id="mediaPdfFrame" allow="autoplay; encrypted-media; fullscreen"></iframe>';
  } else {
    bodyHtml += '<p style="color:var(--ink-soft);">Preview isn\'t available inline for this link — open it directly instead.</p>';
  }
  bodyHtml += '<div class="media-viewer-actions">' +
    (link.type === "pdf" || link.type === "drive" ? '<button class="btn btn-secondary btn-sm" id="mediaFullscreenBtn">Fullscreen</button>' : '') +
    '<a class="btn btn-primary btn-sm" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">Open</a></div>';

  openModal(bodyHtml, () => {
    const fsBtn = document.getElementById("mediaFullscreenBtn");
    if (fsBtn) fsBtn.addEventListener("click", () => {
      const frame = document.getElementById("mediaPdfFrame");
      if (frame.requestFullscreen) frame.requestFullscreen();
    });
  });
}

/* ---------------------------------------------------------
   9c. Lessons — block-based lesson viewer (student side)
   --------------------------------------------------------- */
const LESSON_CATEGORIES = ["Grammar", "Vocabulary", "Speaking", "Writing", "Reading", "Listening", "IELTS", "TOEFL", "MUN", "Business English"];
const LESSON_DIFFICULTIES = ["Beginner", "Elementary", "Intermediate", "Advanced", "Expert"];

let __allLessonsCache = [];

function slidesEmbedUrl(url) {
  // Accepts a Google Slides "Publish to web" or share URL and a Canva
  // "Share > Embed" URL alike — both are just used as-is in an iframe;
  // we only lightly normalize the common Google Slides /edit URL into
  // its /embed form so admins can paste either kind of link.
  const gMatch = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (gMatch) return "https://docs.google.com/presentation/d/" + gMatch[1] + "/embed?start=false&loop=false&delayms=3000";
  return url;
}

function computeReadingMinutes(blocks) {
  let words = 0;
  (blocks || []).forEach(b => {
    const text = document.createElement("div");
    if (b.type === "richtext" || b.type === "tip" || b.type === "warning") text.innerHTML = b.html || "";
    else if (b.type === "heading") text.textContent = b.text || "";
    else if (b.type === "accordion") (b.items || []).forEach(it => { text.innerHTML += " " + (it.title || "") + " " + (it.content || ""); });
    words += (text.textContent || "").trim().split(/\s+/).filter(Boolean).length;
  });
  return Math.max(1, Math.round(words / 200));
}

async function fetchPublishedLessons() {
  const snap = await db.collection("lessons").where("published", "==", true).get();
  const lessons = [];
  snap.forEach(doc => lessons.push({ id: doc.id, ...doc.data() }));
  lessons.sort((a, b) => (a.order || 0) - (b.order || 0));
  return lessons;
}

let __lessonCatFilter = "all";
let __lessonDiffFilter = "all";

async function loadLessonLibrary() {
  const host = document.getElementById("lessonGridHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading lessons…</div>';
  try {
    __allLessonsCache = await fetchPublishedLessons();
    const catSelect = document.getElementById("lessonCategoryFilter");
    const diffSelect = document.getElementById("lessonDifficultyFilter");
    if (catSelect.options.length <= 1) {
      LESSON_CATEGORIES.forEach(c => catSelect.insertAdjacentHTML("beforeend", '<option value="' + c + '">' + c + '</option>'));
    }
    if (diffSelect.options.length <= 1) {
      LESSON_DIFFICULTIES.forEach(d => diffSelect.insertAdjacentHTML("beforeend", '<option value="' + d + '">' + d + '</option>'));
    }
    renderLessonGrid();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("dashAlertHost"), describeFirebaseError(err), { onRetry: loadLessonLibrary });
  }
}

function renderLessonGrid() {
  const host = document.getElementById("lessonGridHost");
  const search = (document.getElementById("lessonSearchInput").value || "").toLowerCase();
  const completed = getCompletedSet();
  const items = __allLessonsCache.filter(l =>
    (__lessonCatFilter === "all" || l.category === __lessonCatFilter) &&
    (__lessonDiffFilter === "all" || l.difficulty === __lessonDiffFilter) &&
    (!search || l.title.toLowerCase().includes(search))
  );
  if (!items.length) { host.innerHTML = '<div class="empty-state"><h3>No lessons found</h3></div>'; return; }

  // The standalone Library is meant to be freely browsable -- every
  // published lesson is open regardless of order, since it's a
  // free-browse reference, not a guided path. Only the level path
  // (levels themselves, and activities/lesson-type-activities within
  // one level, including "lesson" type ones created via the Command
  // Panel) enforces sequential unlocking -- that logic lives in
  // renderLevelPath and is untouched by this.

  // Same winding, top-to-bottom path language as the level path, rather
  // than a plain multi-column grid -- browsing/searching still works
  // exactly as before (this is a layout change only), each lesson just
  // reads as one stop along a path instead of a tile in a grid.
  host.innerHTML = '<div class="lesson-path">' + items.map((l, i) =>
    '<div class="lesson-path-row">' +
    '<div class="lesson-path-node' + (completed[l.id] ? ' complete' : '') + '">' + (completed[l.id] ? '✓' : (i + 1)) + '</div>' +
    '<div class="lesson-card" data-open-lesson="' + l.id + '">' +
    '<div class="lesson-card-tags"><span class="lesson-tag">' + escapeHtml(l.category || "") + '</span>' +
    '<span class="lesson-tag diff-' + escapeHtml(l.difficulty || "") + '">' + escapeHtml(l.difficulty || "") + '</span></div>' +
    '<h4>' + escapeHtml(l.title) + (completed[l.id] ? ' <span class="lesson-done-badge">✓</span>' : '') + '</h4>' +
    '<div class="lesson-meta">⏱️ ' + (l.estimatedMinutes || 1) + ' minute lesson</div>' +
    '</div></div>'
  ).join("") + '</div>';

  host.querySelectorAll("[data-open-lesson]").forEach(card => card.addEventListener("click", () => {
    const lesson = items.find(l => l.id === card.getAttribute("data-open-lesson"));
    openLessonViewer(lesson);
  }));
}

document.getElementById("lessonSearchInput").addEventListener("input", renderLessonGrid);
document.getElementById("lessonCategoryFilter").addEventListener("change", (e) => { __lessonCatFilter = e.target.value; renderLessonGrid(); });
document.getElementById("lessonDifficultyFilter").addEventListener("change", (e) => { __lessonDiffFilter = e.target.value; renderLessonGrid(); });

function renderLessonBlock(block) {
  switch (block.type) {
    case "heading":
      return '<div class="lesson-block"><' + (block.level === "h3" ? "h3" : "h2") + ' class="lesson-block-heading">' + escapeHtml(block.text || "") + '</' + (block.level === "h3" ? "h3" : "h2") + '></div>';
    case "richtext":
      return '<div class="lesson-block rte-render">' + sanitizeRichHtml(block.html || "") + '</div>';
    case "divider":
      return '<hr class="lesson-block-divider">';
    case "image":
      return '<div class="lesson-block lesson-block-image"><img src="' + escapeHtml(block.url || "") + '" alt="' + escapeAttr(block.caption || "") + '">' +
        (block.caption ? '<div class="lesson-img-caption">' + escapeHtml(block.caption) + '</div>' : '') + '</div>';
    case "youtube": {
      const link = parseMediaLink(block.url || "");
      return '<div class="lesson-block"><div class="lesson-embed-wrap"><iframe src="' + escapeHtml(link.embedUrl) + '" allowfullscreen allow="autoplay; encrypted-media"></iframe></div></div>';
    }
    case "slides":
      return '<div class="lesson-block"><div class="lesson-embed-wrap"><iframe src="' + escapeHtml(slidesEmbedUrl(block.url || "")) + '" allowfullscreen></iframe></div></div>';
    case "tip":
      return '<div class="lesson-block lesson-block-tip"><span class="box-label">💡 Tip</span><div class="rte-render">' + sanitizeRichHtml(block.html || "") + '</div></div>';
    case "warning":
      return '<div class="lesson-block lesson-block-warning"><span class="box-label">⚠️ Warning</span><div class="rte-render">' + sanitizeRichHtml(block.html || "") + '</div></div>';
    case "accordion":
      return '<div class="lesson-block">' + (block.items || []).map((it, i) =>
        '<div class="accordion-item" data-acc-index="' + i + '">' +
        '<button type="button" class="accordion-header">' + escapeHtml(it.title || "") + '<span class="chevron">▾</span></button>' +
        '<div class="accordion-body rte-render">' + sanitizeRichHtml(it.content || "") + '</div></div>'
      ).join("") + '</div>';
    case "quiz":
      return '<div class="lesson-block lesson-quiz-block" id="lessonQuizBlockHost"></div>';
    default:
      return "";
  }
}

function wireLessonInteractivity(container, lesson) {
  container.querySelectorAll(".accordion-header").forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".accordion-item").classList.toggle("open"));
  });
  const quizBlock = (lesson.blocks || []).find(b => b.type === "quiz");
  const quizHost = container.querySelector("#lessonQuizBlockHost");
  if (quizBlock && quizHost) {
    renderInlineLessonQuiz(quizHost, quizBlock, lesson);
  }
}

function renderInlineLessonQuiz(host, quizBlock, lesson) {
  const questions = quizBlock.questions || [];
  if (!questions.length) { host.innerHTML = ""; return; }
  const answers = new Array(questions.length).fill(null);
  host.innerHTML = '<p class="eyebrow">Check your understanding</p>' +
    questions.map((q, qi) =>
      '<div class="q-block"><div class="q-text">' + escapeHtml(q.text) + '</div><div class="opt-list">' +
      q.options.map((opt, oi) => '<label class="opt-item" data-qi="' + qi + '" data-oi="' + oi + '">' + escapeHtml(opt) + '</label>').join("") +
      '</div></div>'
    ).join("") +
    '<button class="btn btn-primary" id="lessonQuizSubmitBtn" disabled>Submit answers</button>' +
    '<div id="lessonQuizResultHost" style="margin-top:12px;"></div>';

  host.querySelectorAll(".opt-item").forEach(opt => {
    opt.addEventListener("click", () => {
      const qi = parseInt(opt.getAttribute("data-qi"), 10);
      const oi = parseInt(opt.getAttribute("data-oi"), 10);
      host.querySelectorAll('.opt-item[data-qi="' + qi + '"]').forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      answers[qi] = oi;
      if (answers.every(a => a !== null)) document.getElementById("lessonQuizSubmitBtn").disabled = false;
    });
  });

  document.getElementById("lessonQuizSubmitBtn").addEventListener("click", async () => {
    let correct = 0;
    questions.forEach((q, qi) => { if (answers[qi] === q.correctIndex) correct++; });
    const fraction = correct / questions.length;
    const passed = fraction >= 0.6;
    const resultHost = document.getElementById("lessonQuizResultHost");
    resultHost.innerHTML = '<div class="alert alert-' + (passed ? "success" : "error") + '">' +
      'You got ' + correct + '/' + questions.length + ' correct. ' +
      (passed ? "Nice work — claim your XP below." : "You need 60% to earn XP — review the lesson and try again.") + '</div>';
    if (passed) markLessonComplete(lesson, fraction);
  });
}

async function markLessonComplete(lesson, scoreFraction) {
  const completed = getCompletedSet();
  if (completed[lesson.id]) { showToast("Already completed — no extra XP for a repeat.", "info"); return; }
  const xp = lesson.xpReward || 25;
  try {
    const awarded = await completeActivity(lesson.id, scoreFraction != null ? scoreFraction : 1, xp, lesson.title);
    showToast("+" + awarded.xp + " XP, +" + awarded.points + " JESS Points!", "success");
    await refreshProfileCache();
    updateSidebarStats();
    renderLessonGrid();
    // This was the actual bug: markLessonComplete only ever refreshed the
    // standalone Library view. A "lesson" TYPE ACTIVITY (created via the
    // Command Panel's TYPE: lesson, living inside a level's path) shares
    // this exact same completion function, but its chip lives in the
    // level path, not the Library -- so finishing it correctly recorded
    // as done, while the level path's chips kept showing the stale
    // pre-completion state, leaving the next item looking locked (or
    // otherwise wrong) even though the data underneath was already
    // correct. Safe to call unconditionally: for a real Library lesson
    // this just re-renders a level path that isn't currently relevant.
    renderLevelPath();
    refreshProgressViewsIfVisible();
    closeModal();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}

// Both completion paths (finishing an activity, finishing a lesson) used
// to only refresh the ONE view they came from -- the level path, or the
// lesson grid. Anything showing completion elsewhere (the per-level
// progress bars, the finished-activities table, the XP ledger) stayed
// stale until the whole page was reloaded, which is what "needs a
// refresh to show complete" actually was. These are cheap to call and
// safe to call even when their panel is hidden, so every completion now
// refreshes all of them, not just the one screen it happened on.
function refreshProgressViewsIfVisible() {
  if (typeof renderLevelProgress === "function") renderLevelProgress();
  if (typeof renderCompletedList === "function") renderCompletedList();
  if (typeof renderXpHistory === "function") renderXpHistory();
}

/* ---------------------------------------------------------
   Benefits shop — spend JESS Points on real, staff-fulfilled
   benefits. Items are admin-managed content (their own Firestore
   collection, same pattern as levels/activities); a redemption
   deducts points from the learner's own profile in a transaction and
   writes a durable record for staff to see and follow up on. This is
   NOT an automatic digital reward -- the point is real-world benefits
   (extra break time, a shoutout, first pick of something), so a
   redemption is a request staff need to act on, not something the
   app can fulfil by itself.
   --------------------------------------------------------- */
async function fetchPublishedShopItems() {
  const snap = await db.collection("shopItems").where("published", "==", true).get();
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  items.sort((a, b) => (a.order || 0) - (b.order || 0));
  return items;
}

async function redeemShopItem(item) {
  if (!auth.currentUser) {
    showToast("Create a free account to save up and spend JESS Points.", "info");
    return;
  }
  const uid = auth.currentUser.uid;
  const profileRef = db.collection("users").doc(uid);
  const redemptionRef = db.collection("redemptions").doc();
  try {
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      if (!profileSnap.exists) throw new Error("This account has no learner profile yet.");
      const current = profileSnap.data();
      if ((current.jessPoints || 0) < item.cost) {
        throw Object.assign(new Error("Not enough JESS Points yet."), { code: "insufficient-points" });
      }
      tx.update(profileRef, { jessPoints: current.jessPoints - item.cost });
      tx.set(redemptionRef, {
        userId: uid,
        username: current.username || current.displayName || "",
        itemId: item.id,
        itemTitle: item.title,
        cost: item.cost,
        redeemedAt: firebase.firestore.FieldValue.serverTimestamp(),
        fulfilled: false,
      });
    });
    showToast("Redeemed \"" + item.title + "\"! Staff will follow up with you.", "success");
    await refreshProfileCache();
    updateSidebarStats();
    renderShopGrid();
  } catch (err) {
    if (err.code === "insufficient-points") showToast("You don't have enough JESS Points for this yet.", "info");
    else showToast(describeFirebaseError(err), "error");
  }
}

let __shopItemsCache = [];
async function loadShopPanel() {
  const host = document.getElementById("shopGridHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading the shop…</div>';
  try {
    __shopItemsCache = await fetchPublishedShopItems();
    renderShopGrid();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("dashAlertHost"), describeFirebaseError(err), { onRetry: loadShopPanel });
  }
}

function renderShopGrid() {
  const host = document.getElementById("shopGridHost");
  if (!__shopItemsCache.length) {
    host.innerHTML = '<div class="empty-state"><h3>The shop is empty right now</h3><p>Check back soon — staff are still stocking it.</p></div>';
    return;
  }
  const profile = window.__jessProfileCache || (auth.currentUser ? null : getGuestState());
  const balance = profile ? (profile.jessPoints || 0) : 0;
  host.innerHTML = '<div class="shop-grid">' + __shopItemsCache.map((item) => {
    const canAfford = balance >= item.cost;
    return '<div class="shop-card">' +
      '<div class="shop-card-icon">' + escapeHtml(item.icon || "🎁") + '</div>' +
      '<h4>' + escapeHtml(item.title) + '</h4>' +
      '<p class="shop-card-desc">' + escapeHtml(item.description || "") + '</p>' +
      '<div class="shop-card-foot">' +
      '<span class="shop-cost">' + item.cost + ' JP</span>' +
      '<button type="button" class="btn btn-solid btn-sm" data-redeem="' + item.id + '"' + (canAfford ? "" : " disabled") + '>' +
      (canAfford ? "Redeem" : "Not enough JP") + '</button>' +
      '</div></div>';
  }).join("") + '</div>';
  host.querySelectorAll("[data-redeem]").forEach((btn) =>
    btn.addEventListener("click", () => redeemShopItem(__shopItemsCache.find((i) => i.id === btn.getAttribute("data-redeem"))))
  );
}

function openLessonViewer(lesson) {
  const completed = getCompletedSet();
  const hasQuizBlock = (lesson.blocks || []).some(b => b.type === "quiz");
  const alreadyDone = !!completed[lesson.id];

  const bodyHtml =
    '<div class="lesson-viewer-head"><p class="eyebrow">' + escapeHtml(lesson.category || "") + ' · ' + escapeHtml(lesson.difficulty || "") + ' · ⏱️ ' + (lesson.estimatedMinutes || 1) + ' min</p>' +
    '<h2 style="margin:0 0 12px;">' + escapeHtml(lesson.title) + '</h2>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
    '<button type="button" class="btn btn-outline btn-sm" id="lessonListenBtn">🔊 Listen</button>' +
    '<button type="button" class="btn btn-outline btn-sm" id="lessonSaveOfflineBtn">⬇ Save for offline</button>' +
    '</div></div>' +
    (lesson.blocks || []).map(renderLessonBlock).join("") +
    (!hasQuizBlock ? '<div style="margin-top:24px; text-align:center;">' +
      (alreadyDone
        ? '<span class="badge badge-published">✓ Completed</span>'
        : '<button class="btn btn-primary" id="lessonMarkCompleteBtn">Mark as complete</button>') +
      '</div>' : '');

  openModal(bodyHtml, () => {
    const panel = document.querySelector("#modalHost .modal-panel");
    wireLessonInteractivity(panel, lesson);
    const markBtn = document.getElementById("lessonMarkCompleteBtn");
    if (markBtn) markBtn.addEventListener("click", async () => {
      await markLessonComplete(lesson, 1);
      closeModal();
    });
    wireLessonFreeTools(lesson);
  });
}

// Pulls plain, readable text out of a lesson's blocks (stripping HTML
// from rich-text/tip/warning blocks) for both the "Listen" button and
// the offline text download, since neither should try to read or save
// raw markup.
function lessonPlainText(lesson) {
  const parts = [lesson.title, ""];
  (lesson.blocks || []).forEach((b) => {
    if (b.type === "heading") parts.push(b.text, "");
    else if (b.type === "richtext" || b.type === "tip" || b.type === "warning") {
      const tmp = document.createElement("div");
      tmp.innerHTML = b.html || "";
      parts.push(tmp.textContent.trim(), "");
    } else if (b.type === "accordion") {
      (b.items || []).forEach((item) => parts.push(item.title, item.content, ""));
    }
  });
  return parts.join("\n").trim();
}

/* ---------------------------------------------------------
   Bilingual text-to-speech: detects Indonesian vs English PER
   SENTENCE rather than reading the whole lesson in one fixed voice.
   JessEDU's lessons routinely mix an English target phrase with an
   Indonesian gloss or tip in the same block ("Apple = Apel"), and
   reading the Indonesian half with an English voice (or vice versa)
   is exactly the kind of thing that makes a learner's own model of
   pronunciation worse, not better.

   There is no reliable free language-detection API to call from a
   static site, so this uses a small local word-list heuristic:
   count how many words in a sentence match a short list of common
   Indonesian function words versus common English ones, and go with
   whichever is clearly ahead. It is not linguistically rigorous, but
   for short classroom-style sentences in a two-language app it is
   right the overwhelming majority of the time, and ties default to
   English since that's the language being taught.
   --------------------------------------------------------- */
const ID_MARKER_WORDS = new Set([
  "yang","dan","adalah","untuk","dengan","ini","itu","saya","kamu","anda","kita","kami",
  "tidak","akan","ke","di","dari","atau","juga","bisa","dapat","harus","sudah","belum",
  "apa","siapa","kenapa","mengapa","bagaimana","kapan","dimana","karena","tetapi","tapi",
  "jika","kalau","seperti","sangat","lebih","paling","banyak","sedikit","semua","setiap",
  "kata","artinya","contoh","misalnya","yaitu","adalah","bahwa","supaya","agar","tentang"
]);
const EN_MARKER_WORDS = new Set([
  "the","and","is","are","for","with","this","that","i","you","we","they","he","she",
  "not","will","to","in","from","or","also","can","could","should","already","yet",
  "what","who","why","how","when","where","because","but","if","like","very","more",
  "most","many","few","all","every","word","means","example","that","is","about"
]);

function detectSentenceLang(sentence) {
  const words = sentence.toLowerCase().match(/[a-zàáâãäåèéêëìíîïòóôõöùúûü]+/g) || [];
  if (!words.length) return "en";
  let idScore = 0, enScore = 0;
  words.forEach((w) => {
    if (ID_MARKER_WORDS.has(w)) idScore++;
    if (EN_MARKER_WORDS.has(w)) enScore++;
  });
  return idScore > enScore ? "id" : "en";
}

// Splits on sentence-ending punctuation and blank lines, keeping each
// piece short enough to tag with its own language and voice.
// Breaks lesson text into small speakable chunks with an explicit
// pause AFTER each one: short after a comma, a bit longer after a full
// sentence, longer still between paragraphs. speechSynthesis has no
// SSML/<break> support, so the only way to get a real, controllable
// silence between chunks (rather than the browser's own tiny fixed gap
// between queued utterances) is to speak one chunk at a time and wait
// out an explicit setTimeout before starting the next.
const TTS_PAUSE_COMMA_MS = 140;
const TTS_PAUSE_SENTENCE_MS = 320;
const TTS_PAUSE_PARAGRAPH_MS = 600;

function splitIntoSpeechChunks(text) {
  const paragraphs = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  paragraphs.forEach((para, pi) => {
    const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    sentences.forEach((sentence, si) => {
      // Comma stays attached to the clause before it (reads naturally,
      // "Hello," not "Hello" then "," as its own utterance).
      const clauses = sentence.split(/(?<=,)\s+/).map((c) => c.trim()).filter(Boolean);
      clauses.forEach((clause, ci) => {
        const isLastClause = ci === clauses.length - 1;
        const isLastSentence = si === sentences.length - 1;
        const isLastParagraph = pi === paragraphs.length - 1;
        let pauseAfter = 0;
        if (!isLastClause) pauseAfter = TTS_PAUSE_COMMA_MS;
        else if (!isLastSentence) pauseAfter = TTS_PAUSE_SENTENCE_MS;
        else if (!isLastParagraph) pauseAfter = TTS_PAUSE_PARAGRAPH_MS;
        chunks.push({ text: clause, pauseAfter });
      });
    });
  });
  return chunks;
}

let __ttsVoices = [];
function loadTtsVoices() {
  __ttsVoices = window.speechSynthesis.getVoices();
}
if ("speechSynthesis" in window) {
  loadTtsVoices();
  window.speechSynthesis.onvoiceschanged = loadTtsVoices;
}
function pickVoiceFor(langCode) {
  // Prefers an exact/prefix match (id-ID, id; en-US, en-GB, en) but
  // never blocks on one existing -- if this device has no Indonesian
  // voice installed (common; it isn't bundled everywhere), the
  // utterance's lang stays set to id-ID and the browser falls back to
  // its own best-effort default rather than the lesson failing to
  // read at all.
  const prefix = langCode.split("-")[0];
  return __ttsVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langCode.toLowerCase()))
      || __ttsVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix))
      || null;
}

// Speaks a full lesson chunk by chunk, in order, switching voice and
// BCP-47 language per chunk based on detected language, and waiting out
// each chunk's pause before starting the next (see
// splitIntoSpeechChunks above for why this can't just be a forEach of
// .speak() calls the way it used to be). __ttsStopRequested lets the
// Stop button actually interrupt this chain -- speechSynthesis.cancel()
// alone only stops what's currently playing, it does nothing about a
// setTimeout that's already scheduled to start the NEXT chunk, so
// without this flag "Stop" would pause for a moment and then keep
// talking anyway.
let __ttsStopRequested = false;
let __ttsSequenceRunning = false;
function stopSpeaking() {
  __ttsStopRequested = true;
  __ttsSequenceRunning = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function speakBilingual(text, onEnd) {
  __ttsStopRequested = false;
  const chunks = splitIntoSpeechChunks(text);
  if (!chunks.length) { if (onEnd) onEnd(); return; }
  let idx = 0;
  function playNext() {
    if (__ttsStopRequested) return;
    if (idx >= chunks.length) { if (onEnd) onEnd(); return; }
    const chunk = chunks[idx];
    const lang = detectSentenceLang(chunk.text);
    const utter = new SpeechSynthesisUtterance(chunk.text);
    utter.lang = lang === "id" ? "id-ID" : "en-US";
    const voice = pickVoiceFor(utter.lang);
    if (voice) utter.voice = voice;
    utter.rate = 0.92;
    const advance = () => {
      if (__ttsStopRequested) return;
      idx++;
      if (chunk.pauseAfter > 0) setTimeout(playNext, chunk.pauseAfter);
      else playNext();
    };
    utter.onend = advance;
    utter.onerror = advance; // one bad chunk shouldn't silently kill the rest of the lesson
    window.speechSynthesis.speak(utter);
  }
  playNext();
}

// Text-to-speech ("Listen") and a plain-text download ("Save for
// offline") are both genuinely free: the first uses the browser's own
// SpeechSynthesis API (no server, no cost, works even with no internet
// once the page is loaded), and the second is just a client-side file
// download. Built with students in mind who may have limited or
// unreliable internet access, or want to practise listening without
// needing a fluent speaker nearby.
// Builds a complete, nicely formatted, totally standalone HTML page for
// offline reading -- inline CSS only, no external files or network
// calls, so it opens correctly from a phone's Downloads folder with no
// internet at all. This replaces a flat text dump that just
// concatenated every block into one unbroken paragraph (real headings,
// tip/warning boxes, and quiz questions all read the same as body
// text) and that silently dropped quiz blocks entirely.
function escapeHtmlOffline(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function lessonOfflineHtml(lesson) {
  const parts = [];
  (lesson.blocks || []).forEach((b) => {
    if (b.type === "heading") {
      const tag = b.level === "h3" ? "h3" : "h2";
      parts.push(`<${tag}>${escapeHtmlOffline(b.text || "")}</${tag}>`);
    } else if (b.type === "richtext") {
      parts.push(`<div class="block">${b.html || ""}</div>`);
    } else if (b.type === "tip") {
      parts.push(`<div class="box tip"><span class="box-label">Tip</span>${b.html || ""}</div>`);
    } else if (b.type === "warning") {
      parts.push(`<div class="box warning"><span class="box-label">Note</span>${b.html || ""}</div>`);
    } else if (b.type === "divider") {
      parts.push(`<hr>`);
    } else if (b.type === "image" && b.url) {
      parts.push(`<figure><img src="${escapeHtmlOffline(b.url)}" alt="">` +
        (b.caption ? `<figcaption>${escapeHtmlOffline(b.caption)}</figcaption>` : "") + `</figure>`);
    } else if (b.type === "accordion") {
      parts.push((b.items || []).map((item) =>
        `<div class="accordion-item"><h4>${escapeHtmlOffline(item.title || "")}</h4><p>${escapeHtmlOffline(item.content || "")}</p></div>`
      ).join(""));
    }
    // Quiz blocks intentionally excluded -- same reasoning as the PDF
    // export: an interactive quiz has no meaningful offline form.
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtmlOffline(lesson.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 700px; margin: 0 auto; padding: 32px 24px 80px;
         color: #17241C; background: #FBF8F1; line-height: 1.7; }
  h1 { font-family: system-ui, sans-serif; font-size: 1.8rem; margin-bottom: 4px; }
  h2 { font-family: system-ui, sans-serif; font-size: 1.35rem; margin-top: 36px; }
  h3 { font-family: system-ui, sans-serif; font-size: 1.1rem; margin-top: 24px; }
  .meta { font-family: system-ui, sans-serif; font-size: 0.85rem; color: #6B7280; margin-bottom: 28px; }
  .block p { margin: 0 0 14px; }
  .box { padding: 14px 18px; border-radius: 8px; margin: 18px 0; font-family: system-ui, sans-serif; font-size: 0.95rem; }
  .box.tip { background: #E8F0F7; border-left: 4px solid #2E6DA4; }
  .box.warning { background: #FDF3E3; border-left: 4px solid #B07D26; }
  .box-label { display: block; font-weight: 700; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  hr { border: none; border-top: 1px solid #DED5C4; margin: 28px 0; }
  figure { margin: 20px 0; } figure img { max-width: 100%; border-radius: 8px; }
  figcaption { font-size: 0.82rem; color: #6B7280; margin-top: 6px; font-family: system-ui, sans-serif; }
  .accordion-item { margin-bottom: 14px; }
  .accordion-item h4 { font-family: system-ui, sans-serif; font-size: 1rem; margin-bottom: 4px; }
  .quiz-block { background: #F4EFE3; border-radius: 10px; padding: 18px 22px; margin-top: 32px; font-family: system-ui, sans-serif; }
  .quiz-q { margin-bottom: 18px; }
  .q-text { font-weight: 700; margin-bottom: 8px; }
  .quiz-opts { list-style: none; padding: 0; margin: 0; }
  .quiz-opts li { padding: 6px 10px; border-radius: 6px; margin-bottom: 4px; background: #fff; }
  .quiz-opts li.correct { background: #E7F1EA; font-weight: 700; color: #1B5233; }
  .footer-note { margin-top: 48px; font-family: system-ui, sans-serif; font-size: 0.8rem; color: #9CA3AF; border-top: 1px solid #DED5C4; padding-top: 16px; }
</style>
</head>
<body>
<h1>${escapeHtmlOffline(lesson.title)}</h1>
<p class="meta">${escapeHtmlOffline(lesson.category || "")}${lesson.category && lesson.difficulty ? " · " : ""}${escapeHtmlOffline(lesson.difficulty || "")}${lesson.estimatedMinutes ? " · " + lesson.estimatedMinutes + " min" : ""}</p>
${parts.join("\n")}
<p class="footer-note">Saved for offline reading from JessEDU. Answers marked with ✓ are the correct option for each question.</p>
</body>
</html>`;
}

// Builds a real, properly paginated PDF using jsPDF -- the one external
// library on this site (see index.html for why). jsPDF has no built-in
// HTML-to-PDF layout, so this walks the same block data as the HTML
// export and lays each piece out by hand: word-wrapped paragraphs,
// page breaks inserted before content would run off the bottom of the
// page, and a light visual treatment for headings/tips/warnings/quiz
// questions so it doesn't read as an undifferentiated wall of text.
function lessonToPdfBlob(lesson) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxW = pageW - margin * 2;
  let y = margin;

  function ensureRoom(neededHeight) {
    if (y + neededHeight > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }
  function paragraph(text, opts) {
    opts = opts || {};
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 11);
    // Split on real line breaks FIRST, then word-wrap each piece
    // separately. jsPDF's splitTextToSize wraps by width only and
    // can't be trusted to treat an embedded "\n" as a forced break
    // rather than just another whitespace character it's free to
    // collapse -- doing the hard breaks ourselves guarantees the
    // paragraph/list structure from stripHtmlToText actually survives
    // onto the page instead of getting silently re-flattened here.
    const hardLines = String(text).split("\n");
    hardLines.forEach((hardLine) => {
      const wrapped = doc.splitTextToSize(hardLine, maxW - (opts.indent || 0));
      wrapped.forEach((line) => {
        ensureRoom(opts.lineHeight || 16);
        doc.text(line, margin + (opts.indent || 0), y);
        y += opts.lineHeight || 16;
      });
    });
    y += opts.gapAfter || 0;
  }
  function stripHtmlToText(html) {
    // .textContent alone is what caused the "gibberish": it correctly
    // removes tags but throws away all structure, so <ul><li>A</li>
    // <li>B</li></ul> became the single run "AB" with no space, and
    // separate <p> paragraphs ran straight into each other. This walks
    // the actual DOM tree instead, so paragraph breaks, line breaks,
    // and list bullets survive as real blank lines / bullet points in
    // the PDF, matching how the lesson actually reads on screen.
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    const lines = [];
    let current = "";
    function flush() { if (current.trim()) lines.push(current.trim()); current = ""; }
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) { current += node.nodeValue; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") { current += "\n"; return; }
      if (tag === "li") {
        flush();
        current = "•  ";
        node.childNodes.forEach(walk);
        flush();
        return;
      }
      const isBlock = ["p", "div", "ul", "ol", "h1", "h2", "h3", "h4"].includes(tag);
      if (isBlock) flush();
      node.childNodes.forEach(walk);
      if (isBlock) flush();
    }
    tmp.childNodes.forEach(walk);
    flush();
    // Defense in depth: if anything tag-shaped still made it through
    // (a malformed save, an unclosed tag), strip it rather than let it
    // print as visible "<...>" text.
    return lines.join("\n").replace(/<\/?[a-z][^>]*>/gi, "").trim();
  }

  // Title + meta. The site itself renders the lesson title as an <h2>
  // (same tag as an in-content heading block), so this uses the same
  // size for both rather than treating the title as a bigger, separate
  // tier -- matching how the real lesson viewer actually looks rather
  // than an arbitrary PDF-only hierarchy.
  const H2_SIZE = 20, H3_SIZE = 14;
  paragraph(lesson.title, { bold: true, size: H2_SIZE, lineHeight: 26, gapAfter: 4 });
  const meta = [lesson.category, lesson.difficulty, lesson.estimatedMinutes ? lesson.estimatedMinutes + " min" : ""].filter(Boolean).join("   ·   ");
  if (meta) {
    doc.setTextColor(110, 110, 110);
    paragraph(meta, { size: 9, lineHeight: 13, gapAfter: 14 });
    doc.setTextColor(20, 20, 20);
  }

  (lesson.blocks || []).forEach((b) => {
    if (b.type === "heading") {
      ensureRoom(30);
      y += 6;
      paragraph(b.text || "", { bold: true, size: b.level === "h3" ? H3_SIZE : H2_SIZE, lineHeight: b.level === "h3" ? 19 : 25, gapAfter: 6 });
    } else if (b.type === "richtext") {
      paragraph(stripHtmlToText(b.html), { size: 11, lineHeight: 16, gapAfter: 8 });
    } else if (b.type === "tip" || b.type === "warning") {
      const label = b.type === "tip" ? "TIP" : "NOTE";
      ensureRoom(20);
      doc.setFillColor(b.type === "tip" ? 232 : 253, b.type === "tip" ? 240 : 243, b.type === "tip" ? 247 : 227);
      const text = stripHtmlToText(b.html);
      // Same hard-line-first approach as paragraph() above, so a
      // multi-line tip (a short list, several sentences) keeps its
      // real line breaks instead of being rewrapped into one run.
      const lines = text.split("\n").flatMap((hardLine) => doc.splitTextToSize(hardLine, maxW - 20));
      const boxH = 22 + lines.length * 15;
      ensureRoom(boxH);
      doc.roundedRect(margin, y - 4, maxW, boxH, 4, 4, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(label, margin + 10, y + 10);
      doc.setTextColor(20, 20, 20);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      let ty = y + 26;
      lines.forEach((line) => { doc.text(line, margin + 10, ty); ty += 15; });
      y += boxH + 10;
    } else if (b.type === "accordion") {
      (b.items || []).forEach((item) => {
        paragraph(item.title || "", { bold: true, size: 12, lineHeight: 16, gapAfter: 2 });
        paragraph(item.content || "", { size: 11, lineHeight: 15, gapAfter: 8 });
      });
    }
    // Quiz blocks are deliberately left out of the offline download.
    // The point of "offline" is reading material away from the app;
    // an interactive check-your-understanding quiz has no meaningful
    // offline form (there's nothing to submit it to), so it's simply
    // not included rather than printed as an inert list of questions.
  });

  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text("Saved for offline reading from JessEDU.", margin, pageH - 24);

  return doc.output("blob");
}

function wireLessonFreeTools(lesson) {
  const listenBtn = document.getElementById("lessonListenBtn");
  if (listenBtn && "speechSynthesis" in window) {
    listenBtn.addEventListener("click", () => {
      // speechSynthesis.speaking is false during the deliberate pauses
      // BETWEEN chunks (nothing is actively vocalizing right then), so
      // checking it here would miss a click during one of those gaps
      // and start a second overlapping playback instead of stopping the
      // first. __ttsStopRequested tracks the real "is a sequence
      // running" state regardless of whether something is mid-utterance
      // or mid-pause.
      if (!__ttsStopRequested && (window.speechSynthesis.speaking || __ttsSequenceRunning)) {
        stopSpeaking();
        listenBtn.textContent = "🔊 Listen";
        return;
      }
      listenBtn.textContent = "⏸ Stop";
      __ttsSequenceRunning = true;
      speakBilingual(lessonPlainText(lesson), () => { listenBtn.textContent = "🔊 Listen"; __ttsSequenceRunning = false; });
    });
  } else if (listenBtn) {
    listenBtn.disabled = true;
    listenBtn.title = "Text-to-speech isn't supported in this browser.";
  }

  const saveBtn = document.getElementById("lessonSaveOfflineBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!window.jspdf) {
        // The PDF library comes from a CDN; if it failed to load (no
        // internet the very first time this page was opened, or the
        // CDN is blocked on this network), fall back to the HTML
        // export rather than the button silently doing nothing.
        showToast("Couldn't load the PDF library — saving as an HTML file instead.", "info");
        const blob = new Blob([lessonOfflineHtml(lesson)], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = lesson.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".html";
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const blob = lessonToPdfBlob(lesson);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = lesson.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".pdf";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}


/* ---------------------------------------------------------
   10. Activity modal runner — real modal overlay is OK here
       (no password fields inside; see build notes §4)
   --------------------------------------------------------- */
function openModal(innerHtml, onMount) {
  const host = document.getElementById("modalHost");
  host.innerHTML =
    '<div class="modal-backdrop" id="activeModalBackdrop">' +
    '<div class="modal-panel" role="dialog" aria-modal="true">' +
    '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
    innerHtml +
    '</div></div>';
  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("activeModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "activeModalBackdrop") closeModal();
  });
  if (onMount) onMount();
}
function closeModal() {
  document.getElementById("modalHost").innerHTML = "";
}

function activityXpReward(activity) {
  return activity.xpReward || DEFAULT_XP_BY_TYPE[activity.type] || XP_PER_ACTIVITY;
}

function openActivityModal(activity) {
  const completed = getCompletedSet();
  if (completed[activity.id]) {
    // Previously this was a dead end: a plain "you already did this"
    // message with no way to actually see the questions/content again.
    // Reviewing what you already learned is a normal, useful thing to
    // want to do, so this now offers to actually run the activity again
    // -- renderActivityResult (below) knows to skip trying to claim XP
    // a second time when it gets there, showing a friendly review
    // message instead of an "already completed" error.
    openModal(
      '<div class="result-banner pass"><div class="eyebrow">Completed</div>' +
      '<h3>' + escapeHtml(activity.title) + '</h3>' +
      '<p style="color:var(--ink-soft)">You\'ve already earned XP for this one. You can look through it again any time.</p>' +
      '<div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">' +
      '<button class="btn btn-primary" id="reviewActivityBtn">Review it again</button>' +
      '<button class="btn btn-secondary" id="reviewCloseBtn">Close</button>' +
      '</div></div>'
    );
    document.getElementById("reviewCloseBtn").addEventListener("click", closeModal);
    document.getElementById("reviewActivityBtn").addEventListener("click", () => launchActivityRunner(activity));
    return;
  }
  launchActivityRunner(activity);
}

function launchActivityRunner(activity) {
  const meta = ACTIVITY_TYPE_META[activity.type] || { label: activity.type, icon: "•" };
  const xp = activityXpReward(activity);
  const isReview = !!getCompletedSet()[activity.id];
  openModal(
    '<p class="eyebrow">' + (isReview ? "Reviewing" : "Not started") + '</p>' +
    '<h3 style="margin-bottom:6px;">' + (meta.icon || "") + " " + escapeHtml(activity.title) + '</h3>' +
    '<p style="color:var(--ink-soft); margin-bottom:18px;">' + meta.label + (activity.required === false ? " · Optional" : "") + '</p>' +
    (isReview
      ? '<div class="alert alert-info">You\'ve already completed this one — this is just for review, no extra EXP this time.</div>'
      : '<div class="alert alert-info">Completing this activity will reward <strong>' + xp + ' EXP</strong> (+' + pointsForXp(xp) + ' JESS Points).</div>') +
    '<button class="btn btn-primary btn-block" id="activityStartBtn" style="margin-top:8px;">' + (isReview ? "Review" : "Start") + '</button>',
    () => {
      document.getElementById("activityStartBtn").addEventListener("click", () => {
        if (activity.type === "quiz") runQuizActivity(activity);
        else if (activity.type === "match") runMatchActivity(activity);
        else if (activity.type === "fill") runFillActivity(activity);
        else if (activity.type === "lesson") runLessonActivity(activity);
        else if (activity.type === "flashcards") runFlashcardsActivity(activity);
        else if (activity.type === "listening") runListeningActivity(activity);
        else if (activity.type === "reading") runReadingActivity(activity);
        else if (activity.type === "sentenceBuilder") runSentenceBuilderActivity(activity);
        else if (activity.type === "memoryFlip") runMemoryFlipActivity(activity);
        else if (activity.type === "wordScramble") runWordScrambleActivity(activity);
        else if (activity.type === "speedRound") runSpeedRoundActivity(activity);
        else if (activity.type === "picturePop") runPicturePopActivity(activity);
        else if (activity.type === "oddOneOut") runOddOneOutActivity(activity);
        else if (activity.type === "sentenceOrder") runSentenceOrderActivity(activity);
        else if (activity.type === "listenType") runListenTypeActivity(activity);
        else if (activity.type === "categorize") runCategorizeActivity(activity);
      });
    }
  );
}

function renderActivityResult(activity, correctCount, total) {
  const fraction = total > 0 ? correctCount / total : 0;
  const passed = fraction >= 0.6;
  const xp = activityXpReward(activity);
  const isReview = !!getCompletedSet()[activity.id];
  const host = document.getElementById("modalHost");
  const panel = host.querySelector(".modal-panel");

  const finish = async () => {
    if (isReview) {
      // Already completed before this run started -- this whole playthrough
      // was a review, not a real attempt. Calling completeActivity() again
      // would just throw "Already completed", so skip straight to a
      // friendly close instead of trying to claim a second reward.
      showToast("Nice review! No extra EXP for a repeat, but good practice.", "info");
      closeModal();
      return;
    }
    if (!passed) { closeModal(); renderLevelPath(); return; }
    try {
      const awarded = await completeActivity(activity.id, fraction, xp, activity.title);
      showToast("+" + awarded.xp + " XP, +" + awarded.points + " JESS Points!", "success");
      closeModal();
      await refreshProfileCache();
      updateSidebarStats();
      renderLevelPath();
      refreshProgressViewsIfVisible();
    } catch (err) {
      renderAlert(panel.querySelector(".result-alert-host"), describeFirebaseError(err));
    }
  };

  panel.innerHTML =
    '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
    '<div class="result-banner ' + (passed ? "pass" : "fail") + '">' +
    '<div class="eyebrow">' + (isReview ? "Review complete" : (passed ? "Nice work!" : "So close!")) + '</div>' +
    '<div class="big-score">' + correctCount + '/' + total + '</div>' +
    '<p style="color:var(--ink-soft)">' +
    (isReview ? "Good review! No new EXP since you've already completed this one." :
     passed ? "You passed! Claim to earn around " + xp + " EXP for this activity." : "You need 60% correct to earn XP. Give it another try!") +
    '</p><div class="result-alert-host"></div>' +
    '<div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">' +
    (passed
      ? '<button class="btn btn-primary" id="resultDoneBtn">' + (isReview ? "Done" : "Claim rewards") + '</button>'
      : '<button class="btn btn-primary" id="resultRetryBtn">Try again</button><button class="btn btn-secondary" id="resultCloseBtn">Close</button>') +
    '</div></div>';

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  if (passed) {
    document.getElementById("resultDoneBtn").addEventListener("click", finish);
  } else {
    document.getElementById("resultRetryBtn").addEventListener("click", () => {
      if (activity.type === "quiz") runQuizActivity(activity);
      else if (activity.type === "match") runMatchActivity(activity);
      else if (activity.type === "fill") runFillActivity(activity);
      else if (activity.type === "listening") runListeningActivity(activity);
      else if (activity.type === "reading") runReadingActivity(activity);
      else if (activity.type === "sentenceBuilder") runSentenceBuilderActivity(activity);
      else if (activity.type === "memoryFlip") runMemoryFlipActivity(activity);
      else if (activity.type === "wordScramble") runWordScrambleActivity(activity);
      else if (activity.type === "speedRound") runSpeedRoundActivity(activity);
      else if (activity.type === "picturePop") runPicturePopActivity(activity);
      else if (activity.type === "oddOneOut") runOddOneOutActivity(activity);
      else if (activity.type === "sentenceOrder") runSentenceOrderActivity(activity);
      else if (activity.type === "listenType") runListenTypeActivity(activity);
      else if (activity.type === "categorize") runCategorizeActivity(activity);
    });
    document.getElementById("resultCloseBtn").addEventListener("click", closeModal);
  }
}

async function refreshProfileCache() {
  if (!auth.currentUser) return;
  const snap = await db.collection("users").doc(auth.currentUser.uid).get();
  window.__jessProfileCache = snap.data();
  const progSnap = await db.collection("users").doc(auth.currentUser.uid).collection("progress").get();
  const cache = {};
  progSnap.forEach(d => cache[d.id] = d.data());
  window.__jessProgressCache = cache;
}

function runQuizActivity(activity) {
  const questions = (activity.payload && activity.payload.questions) || [];
  let idx = 0;
  const answers = new Array(questions.length).fill(null);

  function renderQ() {
    const q = questions[idx];
    const panel = document.querySelector("#modalHost .modal-panel");
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Question ' + (idx + 1) + ' of ' + questions.length + '</p>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + (((idx) / questions.length) * 100) + '%"></div></div>' +
      '<div class="q-block"><div class="q-text">' + escapeHtml(q.text) + '</div>' +
      '<div class="opt-list">' +
      q.options.map((opt, i) =>
        '<label class="opt-item" data-i="' + i + '"><input type="radio" name="quizOpt" value="' + i + '"> ' + escapeHtml(opt) + '</label>'
      ).join("") +
      '</div></div>' +
      '<button class="btn btn-primary btn-block" id="quizNextBtn" disabled>' + (idx === questions.length - 1 ? "Finish" : "Next") + '</button>';

      document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
      const opts = panel.querySelectorAll(".opt-item");
      opts.forEach(opt => {
        opt.addEventListener("click", () => {
          opts.forEach(o => o.classList.remove("selected"));
          opt.classList.add("selected");
          opt.querySelector("input").checked = true;
          answers[idx] = parseInt(opt.getAttribute("data-i"), 10);
          document.getElementById("quizNextBtn").disabled = false;
        });
      });
      document.getElementById("quizNextBtn").addEventListener("click", () => {
        if (idx < questions.length - 1) { idx++; renderQ(); }
        else finishQuiz();
      });
  }

  function finishQuiz() {
    let correct = 0;
    questions.forEach((q, i) => { if (answers[i] === q.correctIndex) correct++; });
    renderActivityResult(activity, correct, questions.length);
  }

  openModal("", renderQ);
}

function runMatchActivity(activity) {
  const pairs = (activity.payload && activity.payload.pairs) || [];
  const shuffledDefs = shuffle(pairs.map(p => p.definition));

  const rowsHtml = pairs.map((p, i) =>
    '<div class="match-row"><div class="match-term">' + escapeHtml(p.term) + '</div>' +
    '<select data-i="' + i + '"><option value="">Choose a definition…</option>' +
    shuffledDefs.map(d => '<option value="' + escapeHtml(d) + '">' + escapeHtml(d) + '</option>').join("") +
    '</select></div>'
  ).join("");

  openModal(
    '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Word match</p>' +
    '<h3 style="margin-bottom:16px;">Match each word to its definition</h3>' +
    '<div id="matchRows">' + rowsHtml + '</div>' +
    '<button class="btn btn-primary btn-block" id="matchSubmitBtn" style="margin-top:12px;">Check answers</button>',
    () => {
      document.getElementById("matchSubmitBtn").addEventListener("click", () => {
        const selects = document.querySelectorAll("#matchRows select");
        let correct = 0;
        selects.forEach(sel => {
          const i = parseInt(sel.getAttribute("data-i"), 10);
          if (sel.value === pairs[i].definition) correct++;
        });
        renderActivityResult(activity, correct, pairs.length);
      });
    }
  );
}

function runFillActivity(activity) {
  const items = (activity.payload && activity.payload.items) || [];
  const rowsHtml = items.map((item, i) => {
    const parts = item.sentence.split("___");
    const before = parts[0] || "";
    const after = parts.slice(1).join("___") || "";
    return '<div class="fill-row"><div class="sentence">' + (i + 1) + '. ' + escapeHtml(before) +
      '<input type="text" data-i="' + i + '" style="display:inline-block; width:130px; margin:0 4px; padding:6px 10px; border:1.5px solid var(--line-strong); border-radius:8px;" autocomplete="off">' +
      escapeHtml(after) + '</div></div>';
  }).join("");

  openModal(
    '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Fill in the blank</p>' +
    '<h3 style="margin-bottom:16px;">Complete each sentence</h3>' +
    '<div id="fillRows">' + rowsHtml + '</div>' +
    '<button class="btn btn-primary btn-block" id="fillSubmitBtn" style="margin-top:12px;">Check answers</button>',
    () => {
      document.getElementById("fillSubmitBtn").addEventListener("click", () => {
        const inputs = document.querySelectorAll("#fillRows input");
        let correct = 0;
        inputs.forEach(inp => {
          const i = parseInt(inp.getAttribute("data-i"), 10);
          const given = inp.value.trim().toLowerCase();
          const expected = String(items[i].answer || "").trim().toLowerCase();
          if (given && given === expected) correct++;
        });
        renderActivityResult(activity, correct, items.length);
      });
    }
  );
}

/* ---------------------------------------------------------
   10b. New activity types: Lesson, Flashcards, Listening,
   Reading, Sentence Builder
   --------------------------------------------------------- */

// Lesson-as-activity reuses the exact same block renderer/interactivity
// built for the standalone Lessons library — blocks live under
// activity.payload.blocks instead of a top-level `blocks` field, so we
// pass a thin shim object through to the shared functions.
function runLessonActivity(activity) {
  const shim = {
    id: activity.id, title: activity.title,
    category: activity.category || "", difficulty: activity.difficulty || "",
    estimatedMinutes: activity.estimatedMinutes || 1,
    blocks: (activity.payload && activity.payload.blocks) || [],
    xpReward: activityXpReward(activity),
  };
  openLessonViewer(shim);
}

function runFlashcardsActivity(activity) {
  const cards = (activity.payload && activity.payload.cards) || [];
  if (!cards.length) { closeModal(); return; }
  let idx = 0, knewCount = 0, flipped = false;

  function renderCard() {
    const panel = document.querySelector("#modalHost .modal-panel");
    const card = cards[idx];
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Card ' + (idx + 1) + ' of ' + cards.length + '</p>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + ((idx / cards.length) * 100) + '%"></div></div>' +
      '<div id="flashcardFace" style="min-height:160px; border:1.5px solid var(--line-strong); border-radius:16px; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; font-family:var(--font-display); font-size:1.3rem; cursor:pointer; margin-bottom:16px;">' +
      escapeHtml(flipped ? card.back : card.front) + '</div>' +
      '<p style="text-align:center; color:var(--ink-soft); font-size:0.82rem; margin-bottom:16px;">Tap the card to flip it</p>' +
      (flipped
        ? '<div style="display:flex; gap:10px;"><button class="btn btn-secondary btn-block" id="stillLearningBtn">Still learning</button><button class="btn btn-primary btn-block" id="gotItBtn">Got it!</button></div>'
        : "");

      document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
      document.getElementById("flashcardFace").addEventListener("click", () => { flipped = !flipped; renderCard(); });
      const gotIt = document.getElementById("gotItBtn");
      const stillLearning = document.getElementById("stillLearningBtn");
      if (gotIt) gotIt.addEventListener("click", () => { knewCount++; advance(); });
      if (stillLearning) stillLearning.addEventListener("click", () => advance());
  }

  function advance() {
    flipped = false;
    if (idx < cards.length - 1) { idx++; renderCard(); }
    else finishFlashcards();
  }

  async function finishFlashcards() {
    const xp = activityXpReward(activity);
    const panel = document.querySelector("#modalHost .modal-panel");
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<div class="result-banner pass"><div class="eyebrow">Deck complete</div>' +
      '<div class="big-score">' + knewCount + '/' + cards.length + '</div>' +
      '<p style="color:var(--ink-soft)">You knew ' + knewCount + ' of ' + cards.length + ' cards. Review complete — claim your XP below.</p>' +
      '<div class="result-alert-host"></div>' +
      '<button class="btn btn-primary" id="flashcardsClaimBtn">Claim ' + xp + ' EXP</button></div>';
    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    document.getElementById("flashcardsClaimBtn").addEventListener("click", async () => {
      try {
        await completeActivity(activity.id, knewCount / cards.length, xp, activity.title);
        showToast("+" + xp + " EXP, +" + pointsForXp(xp) + " JESS Points!", "success");
        closeModal();
        await refreshProfileCache();
        updateSidebarStats();
        renderLevelPath();
      } catch (err) {
        renderAlert(panel.querySelector(".result-alert-host"), describeFirebaseError(err));
      }
    });
  }

  openModal("", renderCard);
}

function runListeningActivity(activity) {
  const audioUrl = (activity.payload && activity.payload.audioUrl) || "";
  const questions = (activity.payload && activity.payload.questions) || [];
  let idx = -1; // -1 = the audio intro screen
  const answers = new Array(questions.length).fill(null);

  function renderStep() {
    const panel = document.querySelector("#modalHost .modal-panel");
    if (idx === -1) {
      panel.innerHTML =
        '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
        '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Listening</p>' +
        '<h3 style="margin-bottom:14px;">Listen, then answer the questions</h3>' +
        '<audio src="' + escapeHtml(audioUrl) + '" controls style="width:100%; margin-bottom:18px;"></audio>' +
        '<button class="btn btn-primary btn-block" id="listeningContinueBtn">Continue to questions</button>';
      document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
      document.getElementById("listeningContinueBtn").addEventListener("click", () => { idx = 0; renderStep(); });
      return;
    }
    const q = questions[idx];
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<p class="eyebrow">Question ' + (idx + 1) + ' of ' + questions.length + '</p>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + ((idx / questions.length) * 100) + '%"></div></div>' +
      '<div class="q-block"><div class="q-text">' + escapeHtml(q.text) + '</div><div class="opt-list">' +
      q.options.map((opt, i) => '<label class="opt-item" data-i="' + i + '"><input type="radio" name="lqOpt"> ' + escapeHtml(opt) + '</label>').join("") +
      '</div></div><button class="btn btn-primary btn-block" id="listeningNextBtn" disabled>' + (idx === questions.length - 1 ? "Finish" : "Next") + '</button>';

    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    const opts = panel.querySelectorAll(".opt-item");
    opts.forEach(opt => opt.addEventListener("click", () => {
      opts.forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      answers[idx] = parseInt(opt.getAttribute("data-i"), 10);
      document.getElementById("listeningNextBtn").disabled = false;
    }));
    document.getElementById("listeningNextBtn").addEventListener("click", () => {
      if (idx < questions.length - 1) { idx++; renderStep(); }
      else {
        let correct = 0;
        questions.forEach((qq, i) => { if (answers[i] === qq.correctIndex) correct++; });
        renderActivityResult(activity, correct, questions.length);
      }
    });
  }

  openModal("", renderStep);
}

function runReadingActivity(activity) {
  const passageHtml = (activity.payload && activity.payload.passageHtml) || "";
  const questions = (activity.payload && activity.payload.questions) || [];
  let idx = -1; // -1 = the passage screen
  const answers = new Array(questions.length).fill(null);

  function renderStep() {
    const panel = document.querySelector("#modalHost .modal-panel");
    if (idx === -1) {
      panel.innerHTML =
        '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
        '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Reading</p>' +
        '<div class="rte-render" style="margin-bottom:18px;">' + sanitizeRichHtml(passageHtml) + '</div>' +
        '<button class="btn btn-primary btn-block" id="readingContinueBtn">Continue to questions</button>';
      document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
      document.getElementById("readingContinueBtn").addEventListener("click", () => { idx = 0; renderStep(); });
      return;
    }
    const q = questions[idx];
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<p class="eyebrow">Question ' + (idx + 1) + ' of ' + questions.length + '</p>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + ((idx / questions.length) * 100) + '%"></div></div>' +
      '<div class="q-block"><div class="q-text">' + escapeHtml(q.text) + '</div><div class="opt-list">' +
      q.options.map((opt, i) => '<label class="opt-item" data-i="' + i + '"><input type="radio" name="rqOpt"> ' + escapeHtml(opt) + '</label>').join("") +
      '</div></div><button class="btn btn-primary btn-block" id="readingNextBtn" disabled>' + (idx === questions.length - 1 ? "Finish" : "Next") + '</button>';

    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    const opts = panel.querySelectorAll(".opt-item");
    opts.forEach(opt => opt.addEventListener("click", () => {
      opts.forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      answers[idx] = parseInt(opt.getAttribute("data-i"), 10);
      document.getElementById("readingNextBtn").disabled = false;
    }));
    document.getElementById("readingNextBtn").addEventListener("click", () => {
      if (idx < questions.length - 1) { idx++; renderStep(); }
      else {
        let correct = 0;
        questions.forEach((qq, i) => { if (answers[i] === qq.correctIndex) correct++; });
        renderActivityResult(activity, correct, questions.length);
      }
    });
  }

  openModal("", renderStep);
}

function runSentenceBuilderActivity(activity) {
  const sentences = (activity.payload && activity.payload.sentences) || [];
  let idx = 0;
  let built = [];
  let pool = [];
  let correctCount = 0;

  function setupSentence() {
    built = [];
    pool = shuffle(sentences[idx].words.map((w, i) => ({ word: w, key: i + "_" + Math.random() })));
    renderStep();
  }

  function renderStep() {
    const panel = document.querySelector("#modalHost .modal-panel");
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Sentence ' + (idx + 1) + ' of ' + sentences.length + '</p>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + ((idx / sentences.length) * 100) + '%"></div></div>' +
      '<h3 style="margin-bottom:10px;">Tap the words in the right order</h3>' +
      '<div id="builtSentence" style="min-height:52px; border:1.5px dashed var(--line-strong); border-radius:12px; padding:10px; display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">' +
      built.map(b => '<span class="activity-chip done" data-remove-word="' + b.key + '">' + escapeHtml(b.word) + '</span>').join("") + '</div>' +
      '<div id="wordPool" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px;">' +
      pool.map(p => '<button type="button" class="activity-chip" data-word-key="' + p.key + '">' + escapeHtml(p.word) + '</button>').join("") + '</div>' +
      '<div style="display:flex; gap:10px;"><button class="btn btn-secondary" id="sbResetBtn">Reset</button>' +
      '<button class="btn btn-primary btn-block" id="sbCheckBtn" ' + (pool.length ? "disabled" : "") + '>Check sentence</button></div>';

    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    panel.querySelectorAll("[data-word-key]").forEach(btn => btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-word-key");
      const wIdx = pool.findIndex(p => p.key === key);
      if (wIdx === -1) return;
      built.push(pool[wIdx]);
      pool.splice(wIdx, 1);
      renderStep();
    }));
    panel.querySelectorAll("[data-remove-word]").forEach(chip => chip.addEventListener("click", () => {
      const key = chip.getAttribute("data-remove-word");
      const bIdx = built.findIndex(b => b.key === key);
      if (bIdx === -1) return;
      pool.push(built[bIdx]);
      built.splice(bIdx, 1);
      renderStep();
    }));
    document.getElementById("sbResetBtn").addEventListener("click", setupSentence);
    document.getElementById("sbCheckBtn").addEventListener("click", () => {
      const attempt = built.map(b => b.word);
      const candidates = [sentences[idx].words].concat(sentences[idx].alternates || []);
      const isCorrect = candidates.some(c => c.length === attempt.length && c.every((w, i) => w === attempt[i]));
      if (isCorrect) correctCount++;
      if (idx < sentences.length - 1) { idx++; setupSentence(); }
      else renderActivityResult(activity, correctCount, sentences.length);
    });
  }

  setupSentence();
}

/* ---------------------------------------------------------
   10b. Four new game types: memory flip, word scramble,
   speed round, picture pop
   --------------------------------------------------------- */

/* ---- Memory Flip: classic pairs-matching game -------------------------
   Payload: { pairs: [{ a: "cat", b: "kucing" }, ...] }
   Every card in the grid is one half of a pair (word or its translation);
   the learner flips two at a time looking for a match. */
function runMemoryFlipActivity(activity) {
  const pairs = (activity.payload && activity.payload.pairs) || [];
  const cards = shuffle(
    pairs.flatMap((p, i) => [
      { pairId: i, text: p.a, matched: false },
      { pairId: i, text: p.b, matched: false },
    ])
  );
  let firstPick = null;   // index into `cards` of the currently face-up card
  let busy = false;       // true while showing a mismatched pair briefly
  let attempts = 0;
  let matchedCount = 0;

  const cardHtml = (c, i) =>
    '<button type="button" class="memory-card" data-i="' + i + '" aria-label="Memory card">' +
      '<span class="memory-card-inner">' +
        '<span class="memory-card-back">?</span>' +
        '<span class="memory-card-front">' + escapeHtml(c.text) + '</span>' +
      '</span>' +
    '</button>';

  openModal(
    '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Memory flip</p>' +
    '<h3 style="margin-bottom:4px;">Find every matching pair</h3>' +
    '<p style="color:var(--ink-soft); margin-bottom:16px;">Tap two cards to flip them. Matching pairs stay open.</p>' +
    '<div class="memory-grid" id="memoryGrid">' + cards.map(cardHtml).join("") + '</div>',
    () => {
      const grid = document.getElementById("memoryGrid");
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".memory-card");
        if (!btn || busy) return;
        const i = parseInt(btn.getAttribute("data-i"), 10);
        if (cards[i].matched || btn.classList.contains("flipped")) return;

        btn.classList.add("flipped");

        if (firstPick === null) {
          firstPick = i;
          return;
        }
        attempts++;
        const firstBtn = grid.querySelector('[data-i="' + firstPick + '"]');
        if (cards[firstPick].pairId === cards[i].pairId) {
          cards[firstPick].matched = true;
          cards[i].matched = true;
          matchedCount++;
          btn.classList.add("matched");
          firstBtn.classList.add("matched");
          firstPick = null;
          if (matchedCount === pairs.length) {
            // A perfect run scores 100%; every extra attempt beyond the
            // minimum possible costs a little, so speed and memory both
            // count, but finishing at all still always passes.
            const perfect = pairs.length;
            const scoreFraction = Math.max(0.6, perfect / Math.max(perfect, attempts));
            setTimeout(() => renderActivityResult(activity, Math.round(scoreFraction * perfect), perfect), 500);
          }
        } else {
          busy = true;
          setTimeout(() => {
            btn.classList.remove("flipped");
            firstBtn.classList.remove("flipped");
            firstPick = null;
            busy = false;
          }, 700);
        }
      });
    }
  );
}

/* ---- Word Scramble: unscramble letter tiles ---------------------------
   Payload: { words: [{ word: "apple", hint: "a red fruit" }, ...] }
   Letters render as individual tappable tiles; tapping one moves it into
   the answer row in order, tapping it there sends it back down. */
function runWordScrambleActivity(activity) {
  const words = (activity.payload && activity.payload.words) || [];
  let idx = 0;
  let correctCount = 0;

  function scrambleLetters(word) {
    let letters = word.split("");
    let attempts = 0;
    // Reshuffle if the shuffle happens to land on the original order
    // (common with short words), rather than showing an already-solved word.
    do {
      letters = shuffle(letters);
      attempts++;
    } while (letters.join("") === word && attempts < 8);
    return letters;
  }

  function setupWord() {
    const w = words[idx];
    const scrambled = scrambleLetters(w.word);
    const placed = new Array(w.word.length).fill(null); // index into scrambled, or null

    openModal(
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Word scramble (' + (idx + 1) + '/' + words.length + ')</p>' +
      (w.hint ? '<p style="color:var(--ink-soft); margin-bottom:14px;">Hint: ' + escapeHtml(w.hint) + '</p>' : '') +
      '<div class="scramble-answer" id="scrambleAnswer"></div>' +
      '<div class="scramble-tiles" id="scrambleTiles"></div>' +
      '<div style="display:flex; gap:10px; margin-top:16px;">' +
      '<button class="btn btn-secondary" id="scrambleClearBtn">Clear</button>' +
      '<button class="btn btn-primary btn-block" id="scrambleCheckBtn">Check word</button>' +
      '</div>',
      () => {
        const answerHost = document.getElementById("scrambleAnswer");
        const tilesHost = document.getElementById("scrambleTiles");

        function draw() {
          answerHost.innerHTML = placed.map((si, slot) =>
            '<button type="button" class="scramble-slot ' + (si === null ? "empty" : "filled") + '" data-slot="' + slot + '">' +
            (si === null ? "" : escapeHtml(scrambled[si])) + '</button>'
          ).join("");
          tilesHost.innerHTML = scrambled.map((ch, si) =>
            '<button type="button" class="scramble-tile" data-si="' + si + '" ' +
            (placed.includes(si) ? "disabled" : "") + '>' + escapeHtml(ch) + '</button>'
          ).join("");
        }
        draw();

        tilesHost.addEventListener("click", (e) => {
          const btn = e.target.closest(".scramble-tile");
          if (!btn || btn.disabled) return;
          const si = parseInt(btn.getAttribute("data-si"), 10);
          const emptySlot = placed.indexOf(null);
          if (emptySlot === -1) return;
          placed[emptySlot] = si;
          draw();
        });
        answerHost.addEventListener("click", (e) => {
          const btn = e.target.closest(".scramble-slot");
          if (!btn || btn.classList.contains("empty")) return;
          const slot = parseInt(btn.getAttribute("data-slot"), 10);
          placed[slot] = null;
          draw();
        });
        document.getElementById("scrambleClearBtn").addEventListener("click", () => {
          placed.fill(null);
          draw();
        });
        document.getElementById("scrambleCheckBtn").addEventListener("click", () => {
          if (placed.includes(null)) { showToast("Fill every letter first.", "info"); return; }
          const attempt = placed.map(si => scrambled[si]).join("");
          if (attempt.toLowerCase() === w.word.toLowerCase()) correctCount++;
          idx++;
          if (idx < words.length) setupWord();
          else renderActivityResult(activity, correctCount, words.length);
        });
      }
    );
  }
  setupWord();
}

/* ---- Speed Round: rapid true/false against a countdown ----------------
   Payload: { statements: [{ text: "...", isTrue: true }, ...], seconds: 30 }
   Score is how many the learner answers correctly before the clock runs
   out, so both speed and accuracy matter. */
function runSpeedRoundActivity(activity) {
  const statements = shuffle((activity.payload && activity.payload.statements) || []);
  const totalSeconds = (activity.payload && activity.payload.seconds) || 30;
  let i = 0, correct = 0, timeLeft = totalSeconds, timer = null, ended = false;

  function endRound() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    // Speed Round always "passes" if at least one statement is answered
    // right and every statement seen is counted, since running out of
    // clock is the natural end of the game, not a failure state the
    // way a wrong quiz answer is.
    renderActivityResult(activity, correct, Math.max(1, i));
  }

  function renderStatement() {
    if (i >= statements.length) { endRound(); return; }
    const s = statements[i];
    const panel = document.querySelector("#modalHost .modal-panel");
    if (!panel) return;
    panel.querySelector("#speedStatementText").textContent = s.text;
    panel.querySelector("#speedProgress").textContent = (i + 1) + " / " + statements.length;
  }

  openModal(
    '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Speed round</p>' +
    '<div class="speed-header">' +
      '<span class="speed-timer" id="speedTimer">' + timeLeft + 's</span>' +
      '<span class="speed-progress" id="speedProgress">1 / ' + statements.length + '</span>' +
    '</div>' +
    '<div class="speed-statement" id="speedStatementText" style="margin:20px 0;"></div>' +
    '<div class="speed-buttons">' +
      '<button type="button" class="btn btn-danger btn-lg" id="speedFalseBtn">False</button>' +
      '<button type="button" class="btn btn-primary btn-lg" id="speedTrueBtn">True</button>' +
    '</div>',
    () => {
      renderStatement();
      timer = setInterval(() => {
        timeLeft--;
        const el = document.getElementById("speedTimer");
        if (el) el.textContent = timeLeft + "s";
        if (timeLeft <= 0) endRound();
      }, 1000);

      function answer(said) {
        if (ended || i >= statements.length) return;
        if (said === statements[i].isTrue) correct++;
        i++;
        renderStatement();
        if (i >= statements.length) endRound();
      }
      document.getElementById("speedTrueBtn").addEventListener("click", () => answer(true));
      document.getElementById("speedFalseBtn").addEventListener("click", () => answer(false));
    }
  );
}

/* ---- Picture Pop: tap the picture that matches the word ----------------
   Payload: { rounds: [{ word: "cat", correctEmoji: "🐱", decoyEmojis: ["🐶","🐦","🐟"] }, ...] }
   Built for absolute beginners: no reading comprehension needed beyond
   recognising one written word, since the answer is a picture, not text. */
function runPicturePopActivity(activity) {
  const rounds = (activity.payload && activity.payload.rounds) || [];
  let idx = 0, correct = 0;

  function setupRound() {
    const r = rounds[idx];
    const options = shuffle([r.correctEmoji, ...(r.decoyEmojis || [])]);
    openModal(
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Picture pop (' + (idx + 1) + '/' + rounds.length + ')</p>' +
      '<h3 style="margin-bottom:18px;">Which picture is "' + escapeHtml(r.word) + '"?</h3>' +
      '<div class="picture-grid" id="pictureGrid">' +
        options.map(em => '<button type="button" class="picture-option" data-em="' + escapeHtml(em) + '">' + em + '</button>').join("") +
      '</div>',
      () => {
        document.getElementById("pictureGrid").addEventListener("click", (e) => {
          const btn = e.target.closest(".picture-option");
          if (!btn) return;
          const picked = btn.getAttribute("data-em");
          if (picked === r.correctEmoji) {
            correct++;
            btn.classList.add("correct");
          } else {
            btn.classList.add("wrong");
          }
          setTimeout(() => {
            idx++;
            if (idx < rounds.length) setupRound();
            else renderActivityResult(activity, correct, rounds.length);
          }, 500);
        });
      }
    );
  }
  setupRound();
}

/* ---- Odd One Out: tap the word that doesn't belong ---------------------
   Payload: { rounds: [{ words: ["apple","banana","car","grape"], oddIndex: 2 }] }
   Simple, but genuinely different from the multiple-choice quiz: there's
   no "question text" framing an answer, the learner has to recognise
   the category from the words themselves. */
function runOddOneOutActivity(activity) {
  const rounds = (activity.payload && activity.payload.rounds) || [];
  let idx = 0, correct = 0;

  function setupRound() {
    const r = rounds[idx];
    openModal(
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Odd one out (' + (idx + 1) + '/' + rounds.length + ')</p>' +
      '<h3 style="margin-bottom:16px;">Which one doesn\'t belong?</h3>' +
      '<div class="opt-list" id="oddOneOutList">' +
      r.words.map((w, i) => '<button type="button" class="opt-item" data-i="' + i + '">' + escapeHtml(w) + '</button>').join("") +
      '</div>',
      () => {
        document.getElementById("oddOneOutList").addEventListener("click", (e) => {
          const btn = e.target.closest(".opt-item");
          if (!btn) return;
          const picked = parseInt(btn.getAttribute("data-i"), 10);
          const buttons = document.querySelectorAll("#oddOneOutList .opt-item");
          buttons.forEach((b) => (b.style.pointerEvents = "none"));
          if (picked === r.oddIndex) {
            correct++;
            btn.classList.add("correct");
          } else {
            btn.classList.add("incorrect");
            buttons[r.oddIndex].classList.add("correct");
          }
          setTimeout(() => {
            idx++;
            if (idx < rounds.length) setupRound();
            else renderActivityResult(activity, correct, rounds.length);
          }, 700);
        });
      }
    );
  }
  setupRound();
}

/* ---- Sentence Order: tap scrambled WORDS into the right order ---------
   Payload: { sentences: [{ words: ["I","like","apples"], hint: "" }] }
   Reuses the exact tile-and-slot mechanic from Word Scramble, just
   operating on whole words forming a sentence instead of letters
   forming one word -- a genuinely different skill (word order /
   sentence structure) built on UI the learner already knows. */
function runSentenceOrderActivity(activity) {
  const sentences = (activity.payload && activity.payload.sentences) || [];
  let idx = 0, correct = 0;

  function setupSentence() {
    const s = sentences[idx];
    const correctWords = s.words;
    let shuffled = shuffle(correctWords.slice());
    let attempts = 0;
    while (shuffled.join(" ") === correctWords.join(" ") && attempts < 8 && correctWords.length > 1) {
      shuffled = shuffle(correctWords.slice());
      attempts++;
    }
    const placed = new Array(correctWords.length).fill(null);

    openModal(
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Sentence order (' + (idx + 1) + '/' + sentences.length + ')</p>' +
      (s.hint ? '<p style="color:var(--ink-soft); margin-bottom:14px;">Hint: ' + escapeHtml(s.hint) + '</p>' : '') +
      '<div class="scramble-answer" id="sentOrderAnswer"></div>' +
      '<div class="scramble-tiles" id="sentOrderTiles"></div>' +
      '<div style="display:flex; gap:10px; margin-top:16px;">' +
      '<button class="btn btn-secondary" id="sentOrderClearBtn">Clear</button>' +
      '<button class="btn btn-primary btn-block" id="sentOrderCheckBtn">Check sentence</button>' +
      '</div>',
      () => {
        const answerHost = document.getElementById("sentOrderAnswer");
        const tilesHost = document.getElementById("sentOrderTiles");
        function draw() {
          answerHost.innerHTML = placed.map((si, slot) =>
            '<button type="button" class="scramble-slot ' + (si === null ? "empty" : "filled") + '" data-slot="' + slot + '" style="min-width:60px; width:auto; padding:0 10px;">' +
            (si === null ? "" : escapeHtml(shuffled[si])) + '</button>'
          ).join("");
          tilesHost.innerHTML = shuffled.map((w, si) =>
            '<button type="button" class="scramble-tile" data-si="' + si + '" style="width:auto; min-width:44px; padding:0 12px; text-transform:none;" ' +
            (placed.includes(si) ? "disabled" : "") + '>' + escapeHtml(w) + '</button>'
          ).join("");
        }
        draw();
        tilesHost.addEventListener("click", (e) => {
          const btn = e.target.closest(".scramble-tile");
          if (!btn || btn.disabled) return;
          const si = parseInt(btn.getAttribute("data-si"), 10);
          const emptySlot = placed.indexOf(null);
          if (emptySlot === -1) return;
          placed[emptySlot] = si;
          draw();
        });
        answerHost.addEventListener("click", (e) => {
          const btn = e.target.closest(".scramble-slot");
          if (!btn || btn.classList.contains("empty")) return;
          const slot = parseInt(btn.getAttribute("data-slot"), 10);
          placed[slot] = null;
          draw();
        });
        document.getElementById("sentOrderClearBtn").addEventListener("click", () => { placed.fill(null); draw(); });
        document.getElementById("sentOrderCheckBtn").addEventListener("click", () => {
          if (placed.includes(null)) { showToast("Place every word first.", "info"); return; }
          const attempt = placed.map((si) => shuffled[si]).join(" ").toLowerCase();
          if (attempt === correctWords.join(" ").toLowerCase()) correct++;
          idx++;
          if (idx < sentences.length) setupSentence();
          else renderActivityResult(activity, correct, sentences.length);
        });
      }
    );
  }
  setupSentence();
}

/* ---- Listen and Type: hear it, then type what you heard ---------------
   Payload: { items: [{ text: "apple", lang: "en" }] }
   Uses the site's own free TTS (speakBilingual) rather than needing any
   pre-recorded audio file -- genuinely tests listening comprehension +
   spelling together, which none of the other games do. */
function runListenTypeActivity(activity) {
  const items = (activity.payload && activity.payload.items) || [];
  let idx = 0, correct = 0;

  function setupItem() {
    const item = items[idx];
    openModal(
      '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Listen and type (' + (idx + 1) + '/' + items.length + ')</p>' +
      '<h3 style="margin-bottom:16px;">Listen, then type what you hear</h3>' +
      '<div style="text-align:center; margin-bottom:18px;">' +
      '<button type="button" class="btn btn-secondary" id="listenTypePlayBtn">🔊 Play</button>' +
      '</div>' +
      '<input type="text" id="listenTypeInput" placeholder="Type what you heard" autocomplete="off" ' +
      'style="width:100%; padding:12px 14px; border:1.5px solid var(--rule-dark); border-radius:var(--r); font-size:1rem; margin-bottom:16px;">' +
      '<button class="btn btn-primary btn-block" id="listenTypeCheckBtn">Check</button>',
      () => {
        const play = () => {
          const utter = new SpeechSynthesisUtterance(item.text);
          utter.lang = (item.lang === "id" ? "id-ID" : "en-US");
          const voice = pickVoiceFor(utter.lang);
          if (voice) utter.voice = voice;
          utter.rate = 0.85;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
        };
        document.getElementById("listenTypePlayBtn").addEventListener("click", play);
        if ("speechSynthesis" in window) setTimeout(play, 300);
        document.getElementById("listenTypeCheckBtn").addEventListener("click", () => {
          const typed = document.getElementById("listenTypeInput").value.trim().toLowerCase();
          if (typed === item.text.trim().toLowerCase()) correct++;
          idx++;
          if (idx < items.length) setupItem();
          else renderActivityResult(activity, correct, items.length);
        });
      }
    );
  }
  setupItem();
}

/* ---- Categorize: sort words into one of two buckets --------------------
   Payload: { categoryA: "Animals", categoryB: "Fruits",
              items: [{ word: "Cat", category: "A" }, ...] }
   Tap a word, then tap the bucket it belongs in. Tests classification/
   vocabulary grouping, a different skill from matching pairs 1-to-1. */
function runCategorizeActivity(activity) {
  const payload = activity.payload || {};
  const items = shuffle((payload.items || []).slice());
  let selectedIdx = null;
  let correctCount = 0;
  const results = new Array(items.length).fill(null); // null = not sorted yet

  function render() {
    const host = document.querySelector("#modalHost .modal-panel");
    if (!host) return;
    const remaining = items.map((it, i) => results[i] === null ? { it, i } : null).filter(Boolean);
    const wordsHtml = remaining.length
      ? remaining.map(({ it, i }) => '<button type="button" class="activity-chip' + (selectedIdx === i ? " done" : "") + '" data-word-i="' + i + '">' + escapeHtml(it.word) + '</button>').join("")
      : '<p style="color:var(--ink-soft);">All sorted!</p>';
    host.querySelector("#categorizeWords").innerHTML = wordsHtml;
    host.querySelectorAll("[data-word-i]").forEach((btn) =>
      btn.addEventListener("click", () => { selectedIdx = parseInt(btn.getAttribute("data-word-i"), 10); render(); })
    );
    if (remaining.length === 0) {
      const doneBtn = host.querySelector("#categorizeDoneBtn");
      if (doneBtn) doneBtn.style.display = "block";
    }
  }

  openModal(
    '<p class="eyebrow">' + escapeHtml(activity.title) + ' · Categorize</p>' +
    '<h3 style="margin-bottom:14px;">Tap a word, then tap where it belongs</h3>' +
    '<div id="categorizeWords" class="activity-chip-row" style="margin-bottom:20px;"></div>' +
    '<div style="display:flex; gap:12px;">' +
    '<button type="button" class="btn btn-secondary btn-block" id="categorizeBucketA">' + escapeHtml(payload.categoryA || "Category A") + '</button>' +
    '<button type="button" class="btn btn-secondary btn-block" id="categorizeBucketB">' + escapeHtml(payload.categoryB || "Category B") + '</button>' +
    '</div>' +
    '<button class="btn btn-primary btn-block" id="categorizeDoneBtn" style="margin-top:18px; display:none;">See results</button>',
    () => {
      render();
      function sortInto(bucket) {
        if (selectedIdx === null) { showToast("Tap a word first.", "info"); return; }
        const item = items[selectedIdx];
        if (item.category === bucket) correctCount++;
        results[selectedIdx] = bucket;
        selectedIdx = null;
        render();
      }
      document.getElementById("categorizeBucketA").addEventListener("click", () => sortInto("A"));
      document.getElementById("categorizeBucketB").addEventListener("click", () => sortInto("B"));
      document.getElementById("categorizeDoneBtn").addEventListener("click", () => {
        renderActivityResult(activity, correctCount, items.length);
      });
    }
  );
}

/* ---------------------------------------------------------
   11. Placement quiz
   --------------------------------------------------------- */
async function maybeShowPlacementPrompt() {
  try {
    const doc = await db.collection("placementQuiz").doc("config").get();
    document.getElementById("placementCard").hidden = !doc.exists || !(doc.data().questions || []).length;
  } catch (e) {
    document.getElementById("placementCard").hidden = true;
  }
}

document.getElementById("startPlacementBtn").addEventListener("click", async () => {
  try {
    const doc = await db.collection("placementQuiz").doc("config").get();
    const questions = (doc.data() && doc.data().questions) || [];
    if (!questions.length) { showToast("No placement quiz is available yet.", "error"); return; }
    runPlacementQuiz(questions);
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
});

function runPlacementQuiz(questions) {
  let idx = 0;
  const scores = [];

  function renderQ() {
    const q = questions[idx];
    const panel = document.querySelector("#modalHost .modal-panel");
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<p class="eyebrow">Placement quiz · Question ' + (idx + 1) + ' of ' + questions.length + '</p>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + ((idx / questions.length) * 100) + '%"></div></div>' +
      '<div class="q-block"><div class="q-text">' + escapeHtml(q.text) + '</div><div class="opt-list">' +
      q.options.map((opt, i) => '<label class="opt-item" data-i="' + i + '">' + escapeHtml(opt.text) + '</label>').join("") +
      '</div></div>';

    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    panel.querySelectorAll(".opt-item").forEach(opt => {
      opt.addEventListener("click", () => {
        const i = parseInt(opt.getAttribute("data-i"), 10);
        scores.push(q.options[i].score || 0);
        if (idx < questions.length - 1) { idx++; renderQ(); }
        else finishPlacement();
      });
    });
  }

  function finishPlacement() {
    const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const suggestedLevel = Math.min(4, Math.max(1, Math.round(avg) + 1));
    const panel = document.querySelector("#modalHost .modal-panel");
    panel.innerHTML =
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<div class="result-banner pass"><div class="eyebrow">Your suggested starting point</div>' +
      '<div class="big-score">Level ' + suggestedLevel + '</div>' +
      '<p style="color:var(--ink-soft)">Head to your learning path and start there — or explore any unlocked level.</p>' +
      '<button class="btn btn-primary" id="placementDoneBtn">Go to my path</button></div>';
    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    document.getElementById("placementDoneBtn").addEventListener("click", closeModal);
  }

  openModal("", renderQ);
}

/* ---------------------------------------------------------
   12. Sidebar panel switching (path / progress)
   --------------------------------------------------------- */
document.querySelectorAll("[data-panel]").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll("[data-panel]").forEach(x => x.classList.remove("active"));
    el.classList.add("active");
    const panel = el.getAttribute("data-panel");
    document.getElementById("panelPaths").hidden = panel !== "paths";
    document.getElementById("panelLessons").hidden = panel !== "lessons";
    document.getElementById("panelProgress").hidden = panel !== "progress";
    document.getElementById("panelHistory").hidden = panel !== "history";
    document.getElementById("panelMedia").hidden = panel !== "media";
    const titles = { paths: "Your path to fluent English", lessons: "Lessons", progress: "My progress", history: "XP History", media: "Resources" };
    const eyebrows = { paths: "Learning path", lessons: "Lessons", progress: "Progress", history: "History", media: "Media Library" };
    document.getElementById("dashPanelTitle").textContent = titles[panel] || "";
    document.getElementById("dashPanelEyebrow").textContent = eyebrows[panel] || "";
    if (panel === "progress") { renderLevelProgress(); renderCompletedList(); }
    if (panel === "history") renderXpHistory();
    if (panel === "media") loadMediaLibrary();
    if (panel === "shop") loadShopPanel();
    if (panel === "lessons") loadLessonLibrary();
    __presencePage = panel === "paths" ? "dashboard" : panel;
  });
});

function renderLevelProgress() {
  const host = document.getElementById("levelProgressList");
  if (!host) return;
  if (!__allLevels.length) {
    host.innerHTML = '<div class="empty-state"><h3>No levels published yet</h3></div>';
    return;
  }
  const completed = getCompletedSet();
  host.innerHTML = __allLevels.map((lvl, i) => {
    const acts = __activitiesByLevel[lvl.id] || [];
    const doneCount = acts.filter((a) => completed[a.id]).length;
    const pct = acts.length ? Math.round((doneCount / acts.length) * 100) : 0;
    return `<div class="level-progress-row">
      <div class="level-progress-head">
        <span class="level-progress-title">${escapeHtml(lvl.title || "Level " + (i + 1))}</span>
        <span class="level-progress-count">${doneCount}/${acts.length}</span>
      </div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
}

function renderCompletedList() {
  const host = document.getElementById("completedList");
  const completed = getCompletedSet();
  const ids = Object.keys(completed);
  if (!ids.length) {
    host.innerHTML = '<div class="empty-state"><h3>Nothing completed yet</h3><p>Head to your learning path to start your first activity.</p></div>';
    return;
  }
  let allActs = [];
  Object.values(__activitiesByLevel).forEach(list => allActs = allActs.concat(list));
  host.innerHTML = '<table class="data-table"><thead><tr><th>Activity</th><th>Type</th><th>Score</th></tr></thead><tbody>' +
    ids.map(id => {
      const act = allActs.find(a => a.id === id);
      const rec = completed[id];
      const scoreVal = typeof rec.score === "number" ? Math.round(rec.score * 100) + "%" : "—";
      return '<tr><td>' + escapeHtml(act ? act.title : id) + '</td><td>' + escapeHtml(act ? act.type : "") + '</td><td>' + scoreVal + '</td></tr>';
    }).join("") + '</tbody></table>';
}

function renderXpHistory() {
  const host = document.getElementById("xpHistoryList");
  const completed = getCompletedSet();
  const ids = Object.keys(completed);
  if (!ids.length) {
    host.innerHTML = '<div class="empty-state"><h3>No XP earned yet</h3><p>Complete an activity or lesson to start building your history.</p></div>';
    return;
  }
  let allActs = [];
  Object.values(__activitiesByLevel).forEach(list => allActs = allActs.concat(list));

  const entries = ids.map(id => {
    const rec = completed[id];
    const act = allActs.find(a => a.id === id);
    const lesson = __allLessonsCache.find(l => l.id === id);
    const title = act ? act.title : (lesson ? lesson.title : (rec.title || id));
    const type = act ? act.type : (lesson ? "lesson" : "");
    const ms = rec.completedAt && rec.completedAt.toDate ? rec.completedAt.toDate().getTime() : (typeof rec.completedAt === "number" ? rec.completedAt : 0);
    return { title, type, xp: rec.xpEarned || 0, points: rec.pointsEarned || 0, ms };
  });
  entries.sort((a, b) => b.ms - a.ms);

  host.innerHTML = '<table class="data-table"><thead><tr><th>Activity</th><th>Type</th><th>EXP earned</th></tr></thead><tbody>' +
    entries.map(e =>
      '<tr><td>Completed ' + escapeHtml(e.title) + '</td><td>' + escapeHtml(e.type) + '</td><td>+' + e.xp + ' EXP' + (e.points ? ' · +' + e.points + ' JP' : '') + '</td></tr>'
    ).join("") + '</tbody></table>';
}

/* ---------------------------------------------------------
   13. Analytics visit counter + presence ping
   --------------------------------------------------------- */
async function bumpVisitCounter() {
  try {
    const ref = db.collection("analytics").doc(ANALYTICS_DOC_ID);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, { visits: 1, lastVisitAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        tx.update(ref, { visits: snap.data().visits + 1, lastVisitAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
    });
  } catch (e) { /* non-critical; fail silently */ }
}

function getSessionId() {
  let id = sessionStorage.getItem("jessSessionId");
  if (!id) {
    id = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    sessionStorage.setItem("jessSessionId", id);
  }
  return id;
}

let __presencePage = "landing";
function pingPresence() {
  const ref = db.collection("presence").doc(getSessionId());
  ref.set({
    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    loggedIn: !!auth.currentUser,
    page: __presencePage,
    site: SITE_TAG,
  }).catch(() => { /* non-critical */ });
}

/* ---------------------------------------------------------
   14. Boot
   --------------------------------------------------------- */
document.getElementById("yearNow").textContent = new Date().getFullYear();
showView("landing");
bumpVisitCounter();
pingPresence();
setInterval(pingPresence, 20000);

auth.onAuthStateChanged(async (user) => {
  if (user) {
    __presencePage = "dashboard";
    document.getElementById("guestBanner").hidden = true;
    try {
      const snap = await db.collection("users").doc(user.uid).get();
      window.__jessProfileCache = snap.data();
    } catch (e) { window.__jessProfileCache = null; }
    showView("dashboard");
    await loadDashboard();
    checkPreviewParams();
  } else if (isGuestActive()) {
    __presencePage = "dashboard";
    document.getElementById("guestBanner").hidden = false;
    showView("dashboard");
    loadDashboard();
  }
});

// Admin "Preview" links open this page as index.html?previewActivityId=X
// or ?previewLessonId=X. Firebase Auth persists the same signed-in
// session across same-origin tabs, so if the admin is logged into
// admin.html, this tab already has that session too — the isAdmin()
// clause in firestore.rules is what lets a draft (unpublished) item
// load here even though the normal published-only queries wouldn't
// surface it. No separate preview-rendering code needed: this just
// reuses the exact same viewer the student sees.
async function checkPreviewParams() {
  const params = new URLSearchParams(window.location.search);
  const previewActivityId = params.get("previewActivityId");
  const previewLessonId = params.get("previewLessonId");
  try {
    if (previewActivityId) {
      const snap = await db.collection("activities").doc(previewActivityId).get();
      if (snap.exists) {
        showToast("Preview mode — this won't count toward your XP unless you complete it for real.", "info");
        openActivityModal({ id: snap.id, ...snap.data() });
      }
    } else if (previewLessonId) {
      const snap = await db.collection("lessons").doc(previewLessonId).get();
      if (snap.exists) {
        showToast("Preview mode — completing it here still records progress on this account.", "info");
        openLessonViewer({ id: snap.id, ...snap.data() });
      }
    }
  } catch (err) {
    if (previewActivityId || previewLessonId) showToast("Couldn't load preview: " + describeFirebaseError(err), "error");
  }
}
