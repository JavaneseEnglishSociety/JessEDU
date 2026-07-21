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
const XP_PER_ACTIVITY = 10;
const JESS_POINTS_PER_ACTIVITY = 5;

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

/* ---------------------------------------------------------
   7. Completing an activity
   --------------------------------------------------------- */
async function completeActivity(activityId, scoreFraction) {
  if (auth.currentUser) {
    const uid = auth.currentUser.uid;
    const progressRef = db.collection("users").doc(uid).collection("progress").doc(activityId);
    const profileRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const [progressSnap, profileSnap] = await Promise.all([tx.get(progressRef), tx.get(profileRef)]);
      if (progressSnap.exists) throw Object.assign(new Error("Already completed."), { code: "already-exists" });
      const current = profileSnap.data();
      const newXp = current.xp + XP_PER_ACTIVITY;
      tx.set(progressRef, { completedAt: firebase.firestore.FieldValue.serverTimestamp(), score: scoreFraction });
      tx.update(profileRef, {
        xp: newXp,
        level: levelForXp(newXp),
        jessPoints: current.jessPoints + JESS_POINTS_PER_ACTIVITY,
        streak: nextStreak(current.streak, current.lastActiveDate),
        lastActiveDate: todayStr(),
      });
    });
  } else {
    const state = getGuestState();
    if (state.completed[activityId]) {
      const err = new Error("Already completed."); err.code = "already-exists"; throw err;
    }
    state.completed[activityId] = { completedAt: Date.now(), score: scoreFraction };
    state.xp += XP_PER_ACTIVITY;
    state.jessPoints += JESS_POINTS_PER_ACTIVITY;
    state.level = levelForXp(state.xp);
    state.streak = nextStreak(state.streak, state.lastActiveDate);
    state.lastActiveDate = todayStr();
    setGuestState(state);
  }
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

function levelStateFor(index) {
  const lvl = __allLevels[index];
  const acts = __activitiesByLevel[lvl.id] || [];
  const completed = getCompletedSet();
  const doneCount = acts.filter(a => completed[a.id]).length;
  const isComplete = acts.length > 0 && doneCount === acts.length;

  if (index === 0) return isComplete ? "complete" : "available";
  const prevLvl = __allLevels[index - 1];
  const prevActs = __activitiesByLevel[prevLvl.id] || [];
  const prevDone = prevActs.filter(a => completed[a.id]).length;
  const prevComplete = prevActs.length > 0 && prevDone === prevActs.length;
  if (!prevComplete) return "locked";
  return isComplete ? "complete" : "available";
}

const ACTIVITY_TYPE_META = {
  quiz: { label: "Quiz", color: "var(--leaf)" },
  match: { label: "Word match", color: "var(--sky)" },
  fill: { label: "Fill in the blank", color: "var(--sun)" },
};

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
      acts.forEach(act => {
        const chip = document.createElement("button");
        const done = !!completed[act.id];
        chip.className = "activity-chip" + (done ? " done" : "");
        chip.type = "button";
        const meta = ACTIVITY_TYPE_META[act.type] || { label: act.type, color: "var(--ink-soft)" };
        chip.innerHTML = '<span class="type-dot" style="background:' + meta.color + '"></span>' +
          escapeHtml(act.title) + (done ? " ✓" : "");
        chip.addEventListener("click", () => openActivityModal(act));
        chipRow.appendChild(chip);
      });
      card.appendChild(chipRow);
    } else if (state !== "locked") {
      const p = document.createElement("p");
      p.style.marginTop = "8px";
      p.textContent = "No activities published in this level yet.";
      card.appendChild(p);
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
  host.innerHTML = '<div class="lesson-grid">' + items.map(l =>
    '<div class="lesson-card" data-open-lesson="' + l.id + '">' +
    '<div class="lesson-card-tags"><span class="lesson-tag">' + escapeHtml(l.category || "") + '</span>' +
    '<span class="lesson-tag diff-' + escapeHtml(l.difficulty || "") + '">' + escapeHtml(l.difficulty || "") + '</span></div>' +
    '<h4>' + escapeHtml(l.title) + (completed[l.id] ? ' <span class="lesson-done-badge">✓</span>' : '') + '</h4>' +
    '<div class="lesson-meta">⏱️ ' + (l.estimatedMinutes || 1) + ' minute lesson</div></div>'
  ).join("") + '</div>';
  host.querySelectorAll("[data-open-lesson]").forEach(card =>
    card.addEventListener("click", () => openLessonViewer(items.find(l => l.id === card.getAttribute("data-open-lesson"))))
  );
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
  try {
    await completeActivity(lesson.id, scoreFraction != null ? scoreFraction : 1);
    showToast("+" + XP_PER_ACTIVITY + " XP, +" + JESS_POINTS_PER_ACTIVITY + " JESS Points!", "success");
    await refreshProfileCache();
    updateSidebarStats();
    renderLessonGrid();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}

function openLessonViewer(lesson) {
  const completed = getCompletedSet();
  const hasQuizBlock = (lesson.blocks || []).some(b => b.type === "quiz");
  const alreadyDone = !!completed[lesson.id];

  const bodyHtml =
    '<div class="lesson-viewer-head"><p class="eyebrow">' + escapeHtml(lesson.category || "") + ' · ' + escapeHtml(lesson.difficulty || "") + ' · ⏱️ ' + (lesson.estimatedMinutes || 1) + ' min</p>' +
    '<h2 style="margin:0;">' + escapeHtml(lesson.title) + '</h2></div>' +
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
  });
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

function openActivityModal(activity) {
  const completed = getCompletedSet();
  if (completed[activity.id]) {
    openModal(
      '<div class="result-banner pass"><div class="eyebrow">Already completed</div>' +
      '<h3>' + escapeHtml(activity.title) + '</h3>' +
      '<p style="color:var(--ink-soft)">You\'ve already earned XP for this activity.</p></div>'
    );
    return;
  }
  if (activity.type === "quiz") runQuizActivity(activity);
  else if (activity.type === "match") runMatchActivity(activity);
  else if (activity.type === "fill") runFillActivity(activity);
}

function renderActivityResult(activity, correctCount, total) {
  const fraction = total > 0 ? correctCount / total : 0;
  const passed = fraction >= 0.6;
  const host = document.getElementById("modalHost");
  const panel = host.querySelector(".modal-panel");

  const finish = async () => {
    if (!passed) { closeModal(); renderLevelPath(); return; }
    try {
      await completeActivity(activity.id, fraction);
      showToast("+" + XP_PER_ACTIVITY + " XP, +" + JESS_POINTS_PER_ACTIVITY + " JESS Points!", "success");
      closeModal();
      await refreshProfileCache();
      updateSidebarStats();
      renderLevelPath();
    } catch (err) {
      renderAlert(panel.querySelector(".result-alert-host"), describeFirebaseError(err));
    }
  };

  panel.innerHTML =
    '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
    '<div class="result-banner ' + (passed ? "pass" : "fail") + '">' +
    '<div class="eyebrow">' + (passed ? "Nice work!" : "So close!") + '</div>' +
    '<div class="big-score">' + correctCount + '/' + total + '</div>' +
    '<p style="color:var(--ink-soft)">' +
    (passed ? "You passed and earned XP for this activity." : "You need 60% correct to earn XP. Give it another try!") +
    '</p><div class="result-alert-host"></div>' +
    '<div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">' +
    (passed
      ? '<button class="btn btn-primary" id="resultDoneBtn">Claim rewards</button>'
      : '<button class="btn btn-primary" id="resultRetryBtn">Try again</button><button class="btn btn-secondary" id="resultCloseBtn">Close</button>') +
    '</div></div>';

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  if (passed) {
    document.getElementById("resultDoneBtn").addEventListener("click", finish);
  } else {
    document.getElementById("resultRetryBtn").addEventListener("click", () => openActivityModal(activity));
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
    document.getElementById("panelMedia").hidden = panel !== "media";
    const titles = { paths: "Your path to fluent English", lessons: "Lessons", progress: "My progress", media: "Resources" };
    const eyebrows = { paths: "Learning path", lessons: "Lessons", progress: "Progress", media: "Media Library" };
    document.getElementById("dashPanelTitle").textContent = titles[panel] || "";
    document.getElementById("dashPanelEyebrow").textContent = eyebrows[panel] || "";
    if (panel === "progress") renderCompletedList();
    if (panel === "media") loadMediaLibrary();
    if (panel === "lessons") loadLessonLibrary();
    __presencePage = panel === "paths" ? "dashboard" : panel;
  });
});

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
    loadDashboard();
  } else if (isGuestActive()) {
    __presencePage = "dashboard";
    document.getElementById("guestBanner").hidden = false;
    showView("dashboard");
    loadDashboard();
  }
});
