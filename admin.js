/* =========================================================
   admin.js — JESS admin panel logic
   ========================================================= */

/* ---------------------------------------------------------
   0. Shared helpers
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
    return "Incorrect passcode.";
  if (code === "auth/too-many-requests") return "Too many attempts — wait a moment.";
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
  hostEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "alert alert-" + (opts.type || "error");
  const span = document.createElement("span");
  span.textContent = message;
  div.appendChild(span);
  if (opts.onRetry) {
    const btn = document.createElement("button");
    btn.className = "retry-btn"; btn.type = "button"; btn.textContent = "Retry";
    btn.addEventListener("click", opts.onRetry);
    div.appendChild(btn);
  }
  hostEl.appendChild(div);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, "&quot;"); }
function setBtnLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner" aria-hidden="true"></span> <span>Please wait…</span>'
    : '<span class="btn-label">' + label + "</span>";
}

/* ---------------------------------------------------------
   1. Passcode gate / logout — full-page views, never modals
   ---------------------------------------------------------
   Ported from JessPortal: this is now a purely LOCAL password check,
   never a real Firebase sign-in. `isAdminUnlocked` lives only in this
   tab's memory — true after a correct password, reset on logout or
   reload. There is no session, no token, nothing persisted.

   This only means anything because firestore.rules was changed to
   stop requiring a signed-in Firebase account for JessEDU's own
   CONTENT collections (levels, activities, lessons, media,
   placementQuiz) — Firestore's rules run server-side and can't see
   this password, so removing the real auth check there is what makes
   a repo-local password meaningful instead of a UI dead end. Student
   accounts (users/{uid} and their progress) are completely untouched
   and still require real Firebase Authentication, since app.js's own
   learner login is unrelated to this and still does the real thing.
   --------------------------------------------------------- */
let isAdminUnlocked = false;

function showAdminView(name) {
  document.getElementById("adminGate").hidden = name !== "gate";
  document.getElementById("adminDashboard").hidden = name !== "dashboard";
}

document.getElementById("adminLoginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const alertHost = document.getElementById("adminGateAlert");
  renderAlert(alertHost, "");
  const passcode = document.getElementById("authSecret9").value;
  const btn = document.getElementById("adminLoginBtn");
  setBtnLoading(btn, true);
  const expected = window.ADMIN_PASSWORD;
  setTimeout(() => {
    // The tiny delay is cosmetic only (matches the old sign-in call's
    // perceived latency) — the check itself is instant and local.
    if (expected && passcode === expected) {
      isAdminUnlocked = true;
      showAdminView("dashboard");
      bootAdminDashboard();
    } else {
      renderAlert(alertHost, "Incorrect password.");
    }
    setBtnLoading(btn, false, "Enter admin panel");
  }, 150);
});

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  isAdminUnlocked = false;
  showAdminView("gate");
});

// Runs once on load. No real onAuthStateChanged to listen to anymore,
// so this just reflects whatever isAdminUnlocked already is (false,
// on a fresh page load — there is no persisted session by design).
showAdminView(isAdminUnlocked ? "dashboard" : "gate");
if (isAdminUnlocked) bootAdminDashboard();

/* ---------------------------------------------------------
   2. Sidebar panel switching
   --------------------------------------------------------- */
const ADMIN_PANELS = ["overview", "learners", "levels", "activities", "ai", "lessons", "commands", "placement", "media"];
document.querySelectorAll("[data-admin-panel]").forEach(el => {
  el.addEventListener("click", () => {
    const panel = el.getAttribute("data-admin-panel");
    document.querySelectorAll("[data-admin-panel]").forEach(x => x.classList.toggle("active", x === el));
    ADMIN_PANELS.forEach(p => {
      document.getElementById("adminPanel" + p[0].toUpperCase() + p.slice(1)).hidden = p !== panel;
    });
    if (panel === "learners") loadLearners();
    if (panel === "levels") loadLevelsPanel();
    if (panel === "activities") loadActivitiesPanel();
    if (panel === "ai") initAiAssistant();
    if (panel === "lessons") loadLessonsPanel();
    if (panel === "commands") initCommandPanel();
    if (panel === "placement") loadPlacementPanel();
    if (panel === "media") loadMediaPanel();
  });
});

let __overviewInterval = null;
function bootAdminDashboard() {
  loadOverview();
  if (__overviewInterval) clearInterval(__overviewInterval);
  __overviewInterval = setInterval(loadOverview, 15000);
}

/* ---------------------------------------------------------
   3. Overview
   --------------------------------------------------------- */
async function loadOverview() {
  const alertHost = document.getElementById("adminAlertHost");
  try {
    const [analyticsSnap, presenceSnap, usersSnap] = await Promise.all([
      db.collection("analytics").doc(ANALYTICS_DOC_ID).get(),
      db.collection("presence").get(),
      db.collection("users").get(),
    ]);

    const analytics = analyticsSnap.exists ? analyticsSnap.data() : { visits: 0, lastVisitAt: null };
    document.getElementById("kpiVisits").textContent = analytics.visits || 0;
    document.getElementById("kpiLastVisit").textContent = analytics.lastVisitAt
      ? analytics.lastVisitAt.toDate().toLocaleString() : "—";
    document.getElementById("kpiLearners").textContent = usersSnap.size;

    const now = Date.now();
    const sessions = [];
    presenceSnap.forEach(doc => {
      const d = doc.data();
      if (d.site !== SITE_TAG) return;
      const lastSeenMs = d.lastSeen && d.lastSeen.toDate ? d.lastSeen.toDate().getTime() : 0;
      sessions.push({ id: doc.id, ...d, lastSeenMs, ageSec: Math.round((now - lastSeenMs) / 1000) });
    });
    const online = sessions.filter(s => s.ageSec <= 90);
    document.getElementById("kpiOnline").textContent = online.length;

    sessions.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    const host = document.getElementById("presenceTableHost");
    if (!sessions.length) {
      host.innerHTML = '<div class="empty-state"><h3>No sessions yet</h3></div>';
    } else {
      host.innerHTML = '<table class="data-table"><thead><tr><th>Session</th><th>Page</th><th>Status</th><th>Last seen</th></tr></thead><tbody>' +
        sessions.slice(0, 50).map(s =>
          '<tr><td>' + escapeHtml(s.id.slice(0, 14)) + '…</td><td>' + escapeHtml(s.page || "—") + '</td>' +
          '<td>' + (s.loggedIn ? '<span class="badge badge-published">learner</span>' : '<span class="badge badge-draft">guest</span>') +
          (s.ageSec <= 90 ? ' <span class="badge badge-online">online</span>' : '') + '</td>' +
          '<td>' + s.ageSec + 's ago</td></tr>'
        ).join("") + '</tbody></table>';
    }
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err), { onRetry: loadOverview });
  }
}

document.getElementById("clearStaleBtn").addEventListener("click", async () => {
  const btn = document.getElementById("clearStaleBtn");
  setBtnLoading(btn, true);
  try {
    const snap = await db.collection("presence").get();
    const now = Date.now();
    const stale = [];
    snap.forEach(doc => {
      const d = doc.data();
      const lastSeenMs = d.lastSeen && d.lastSeen.toDate ? d.lastSeen.toDate().getTime() : 0;
      if ((now - lastSeenMs) / 1000 > 300) stale.push(doc.ref);
    });
    await Promise.all(stale.map(ref => ref.delete()));
    showToast("Cleared " + stale.length + " stale session(s).", "success");
    loadOverview();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  } finally {
    setBtnLoading(btn, false, "Clear stale sessions");
  }
});

/* ---------------------------------------------------------
   4. Learners
   --------------------------------------------------------- */
async function loadLearners() {
  const host = document.getElementById("learnersTableHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading learners…</div>';
  try {
    const snap = await db.collection("users").get();
    const learners = [];
    snap.forEach(doc => learners.push({ id: doc.id, ...doc.data() }));
    learners.sort((a, b) => (b.xp || 0) - (a.xp || 0));
    if (!learners.length) {
      host.innerHTML = '<div class="empty-state"><h3>No learners yet</h3></div>';
      return;
    }
    host.innerHTML = '<table class="data-table"><thead><tr><th>Username</th><th>Level</th><th>XP</th><th>JESS Points</th><th>Streak</th></tr></thead><tbody>' +
      learners.map(u =>
        '<tr><td>' + escapeHtml(u.displayName || u.username) + '</td><td>' + (u.level || 1) + '</td>' +
        '<td>' + (u.xp || 0) + '</td><td>' + (u.jessPoints || 0) + '</td><td>' + (u.streak || 0) + '</td></tr>'
      ).join("") + '</tbody></table>';
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadLearners });
  }
}

/* ---------------------------------------------------------
   5. Modal helper (reused for level/activity/placement editors)
   --------------------------------------------------------- */
function openAdminModal(innerHtml, onMount) {
  const host = document.getElementById("modalHost");
  host.innerHTML =
    '<div class="modal-backdrop" id="activeModalBackdrop"><div class="modal-panel" role="dialog" aria-modal="true">' +
    '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' + innerHtml + '</div></div>';
  document.getElementById("modalCloseBtn").addEventListener("click", closeAdminModal);
  document.getElementById("activeModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "activeModalBackdrop") closeAdminModal();
  });
  if (onMount) onMount();
}
function closeAdminModal() { document.getElementById("modalHost").innerHTML = ""; }

/* ---------------------------------------------------------
   6. Levels CRUD
   --------------------------------------------------------- */
async function loadLevelsPanel() {
  const host = document.getElementById("levelsListHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading levels…</div>';
  try {
    const snap = await db.collection("levels").get();
    const levels = [];
    snap.forEach(doc => levels.push({ id: doc.id, ...doc.data() }));
    levels.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!levels.length) {
      host.innerHTML = '<div class="empty-state"><h3>No levels yet</h3><p>Create your first level to get started.</p></div>';
      return;
    }
    host.innerHTML = levels.map(lvl =>
      '<div class="card"><div class="card-row">' +
      '<div><h3 style="margin-bottom:2px;">' + escapeHtml(lvl.title) + ' <span class="badge ' + (lvl.published ? "badge-published" : "badge-draft") + '">' + (lvl.published ? "Published" : "Draft") + '</span></h3>' +
      '<p style="color:var(--ink-soft); margin:0;">Order ' + (lvl.order || 0) + ' · ' + escapeHtml(lvl.description || "") + '</p></div>' +
      '<div style="display:flex; gap:8px;">' +
      '<button class="btn btn-secondary btn-sm" data-edit-level="' + lvl.id + '">Edit</button>' +
      '<button class="btn btn-danger btn-sm" data-delete-level="' + lvl.id + '">Delete</button>' +
      '</div></div></div>'
    ).join("");

    host.querySelectorAll("[data-edit-level]").forEach(btn =>
      btn.addEventListener("click", () => openLevelEditor(levels.find(l => l.id === btn.getAttribute("data-edit-level"))))
    );
    host.querySelectorAll("[data-delete-level]").forEach(btn =>
      btn.addEventListener("click", () => deleteLevel(btn.getAttribute("data-delete-level")))
    );
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadLevelsPanel });
  }
}

document.getElementById("newLevelBtn").addEventListener("click", () => openLevelEditor(null));

function openLevelEditor(level) {
  const isNew = !level;
  openAdminModal(
    '<h3 style="margin-bottom:16px;">' + (isNew ? "New level" : "Edit level") + '</h3>' +
    '<div id="levelEditorAlert"></div>' +
    '<div class="field"><label>Title</label><input type="text" id="levelTitleInput" value="' + escapeAttr(level ? level.title : "") + '"></div>' +
    '<div class="field"><label>Order (lower shows first)</label><input type="number" id="levelOrderInput" value="' + (level ? level.order : 0) + '"></div>' +
    '<div class="field"><label>Description</label><div id="levelDescRte"></div></div>' +
    '<div class="field"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="levelPublishedInput" ' + (level && level.published ? "checked" : "") + ' style="width:auto;"> Published (visible to learners)</label></div>' +
    '<button class="btn btn-primary btn-block" id="saveLevelBtn">Save level</button>',
    () => {
      const levelDescEditor = createRichTextEditor(document.getElementById("levelDescRte"), level ? level.description : "");
      document.getElementById("saveLevelBtn").addEventListener("click", async () => {
        const alertHost = document.getElementById("levelEditorAlert");
        const btn = document.getElementById("saveLevelBtn");
        const title = document.getElementById("levelTitleInput").value.trim();
        if (!title) { renderAlert(alertHost, "Title is required."); return; }
        const data = {
          title,
          order: parseInt(document.getElementById("levelOrderInput").value, 10) || 0,
          description: levelDescEditor.getHtml(),
          published: document.getElementById("levelPublishedInput").checked,
        };
        setBtnLoading(btn, true);
        try {
          if (isNew) await db.collection("levels").add(data);
          else await db.collection("levels").doc(level.id).update(data);
          showToast("Level saved.", "success");
          closeAdminModal();
          loadLevelsPanel();
        } catch (err) {
          renderAlert(alertHost, describeFirebaseError(err));
        } finally {
          setBtnLoading(btn, false, "Save level");
        }
      });
    }
  );
}

async function deleteLevel(levelId) {
  if (!confirm("Delete this level? Activities under it will remain but be orphaned.")) return;
  try {
    await db.collection("levels").doc(levelId).delete();
    showToast("Level deleted.", "success");
    loadLevelsPanel();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}

/* ---------------------------------------------------------
   6b. Rich text editor (shared by any admin field)
   --------------------------------------------------------- */
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

function createRichTextEditor(container, initialHtml) {
  container.innerHTML =
    '<div class="rte-wrap"><div class="rte-toolbar">' +
    '<button type="button" class="rte-btn" data-cmd="bold" title="Bold"><b>B</b></button>' +
    '<button type="button" class="rte-btn" data-cmd="italic" title="Italic"><i>I</i></button>' +
    '<button type="button" class="rte-btn" data-cmd="underline" title="Underline"><u>U</u></button>' +
    '<div class="rte-divider"></div>' +
    '<button type="button" class="rte-btn" data-cmd="formatBlock" data-val="H2" title="Heading">H2</button>' +
    '<button type="button" class="rte-btn" data-cmd="formatBlock" data-val="H3" title="Subheading">H3</button>' +
    '<button type="button" class="rte-btn" data-cmd="formatBlock" data-val="P" title="Paragraph">¶</button>' +
    '<div class="rte-divider"></div>' +
    '<button type="button" class="rte-btn" data-cmd="insertUnorderedList" title="Bullet list">•—</button>' +
    '<button type="button" class="rte-btn" data-cmd="insertOrderedList" title="Numbered list">1.</button>' +
    '<button type="button" class="rte-btn" data-cmd="formatBlock" data-val="BLOCKQUOTE" title="Quote">❝</button>' +
    '<button type="button" class="rte-btn" data-cmd="formatBlock" data-val="PRE" title="Code block">&lt;/&gt;</button>' +
    '<div class="rte-divider"></div>' +
    '<button type="button" class="rte-btn" data-action="link" title="Link">🔗</button>' +
    '<button type="button" class="rte-btn" data-action="image" title="Image URL">🖼️</button>' +
    '<button type="button" class="rte-btn" data-action="table" title="Insert table">▦</button>' +
    '<button type="button" class="rte-btn" data-action="callout" title="Callout box">💡</button>' +
    '</div><div class="rte-content" contenteditable="true">' + (initialHtml || "<p></p>") + '</div></div>';

  const contentEl = container.querySelector(".rte-content");

  container.querySelectorAll("[data-cmd]").forEach(btn => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      contentEl.focus();
      document.execCommand(btn.getAttribute("data-cmd"), false, btn.getAttribute("data-val") || null);
    });
  });
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      contentEl.focus();
      const action = btn.getAttribute("data-action");
      if (action === "link") {
        const url = prompt("Link URL:");
        if (url) document.execCommand("createLink", false, url);
      } else if (action === "image") {
        const url = prompt("Image URL (upload it to the Media Library first, then paste its URL here):");
        if (url) document.execCommand("insertImage", false, url);
      } else if (action === "table") {
        document.execCommand("insertHTML", false,
          '<table><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table><p></p>');
      } else if (action === "callout") {
        document.execCommand("insertHTML", false, '<div class="callout">💡 &nbsp;</div><p></p>');
      }
    });
  });

  return {
    getHtml: () => sanitizeRichHtml(contentEl.innerHTML),
    setHtml: (html) => { contentEl.innerHTML = html || "<p></p>"; },
  };
}

/* ---------------------------------------------------------
   6c. Media Library (admin) — link-based, no Cloud Storage
   (Firebase now requires the paid Blaze plan for Storage, even
   at zero usage, so resources are external links instead:
   Google Drive, YouTube, or any direct file URL. The file stays
   wherever the admin hosted it — this collection just indexes it.)
   --------------------------------------------------------- */
const MEDIA_CATEGORIES = ["Images", "Videos", "Audio", "Presentations", "Worksheets", "Icons", "Other"];

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

let __adminAllMedia = [];
let __adminMediaCatFilter = "all";

async function loadMediaPanel() {
  const catSelect = document.getElementById("mediaCategoryInput");
  if (!catSelect.options.length) {
    catSelect.innerHTML = MEDIA_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join("");
  }
  await refreshAdminMediaGrid();
}

async function refreshAdminMediaGrid() {
  const host = document.getElementById("adminMediaGridHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading media…</div>';
  try {
    const snap = await db.collection("media").get();
    __adminAllMedia = [];
    snap.forEach(doc => __adminAllMedia.push({ id: doc.id, ...doc.data() }));
    __adminAllMedia.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    renderAdminMediaTabs();
    renderAdminMediaGrid();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: refreshAdminMediaGrid });
  }
}

function renderAdminMediaTabs() {
  const host = document.getElementById("adminMediaCatTabs");
  const cats = ["all"].concat(MEDIA_CATEGORIES);
  host.innerHTML = cats.map(c =>
    '<button type="button" class="media-cat-tab ' + (c === __adminMediaCatFilter ? "active" : "") + '" data-cat="' + c + '">' + (c === "all" ? "All" : c) + '</button>'
  ).join("");
  host.querySelectorAll("[data-cat]").forEach(btn =>
    btn.addEventListener("click", () => { __adminMediaCatFilter = btn.getAttribute("data-cat"); renderAdminMediaTabs(); renderAdminMediaGrid(); })
  );
}

function renderAdminMediaGrid() {
  const host = document.getElementById("adminMediaGridHost");
  const search = (document.getElementById("adminMediaSearchInput").value || "").toLowerCase();
  const items = __adminAllMedia.filter(m =>
    (__adminMediaCatFilter === "all" || m.category === __adminMediaCatFilter) &&
    (!search || m.title.toLowerCase().includes(search) || (m.tags || []).join(" ").toLowerCase().includes(search))
  );
  if (!items.length) { host.innerHTML = '<div class="empty-state"><h3>No media found</h3></div>'; return; }
  host.innerHTML = '<div class="media-grid">' + items.map(m => {
    const link = parseMediaLink(m.url || "");
    return '<div class="media-card" data-open-media="' + m.id + '">' +
      '<div class="media-thumb">' + (link.type === "image" ? '<img src="' + escapeAttr(m.url) + '" alt="">' : '<span>' + link.icon + '</span>') + '</div>' +
      '<div class="media-info"><h4>' + escapeHtml(m.title) + '</h4><span class="media-cat-label">' + escapeHtml(m.category) + (m.published ? "" : " · draft") + '</span></div></div>';
  }).join("") + '</div>';
  host.querySelectorAll("[data-open-media]").forEach(card =>
    card.addEventListener("click", () => openAdminMediaEditor(items.find(m => m.id === card.getAttribute("data-open-media"))))
  );
}

document.getElementById("adminMediaSearchInput").addEventListener("input", renderAdminMediaGrid);

document.getElementById("mediaUploadBtn").addEventListener("click", async () => {
  const alertHost = document.getElementById("mediaUploadAlert");
  renderAlert(alertHost, "");
  const url = document.getElementById("mediaUrlInput").value.trim();
  const title = document.getElementById("mediaTitleInput").value.trim();
  const category = document.getElementById("mediaCategoryInput").value;
  const tags = document.getElementById("mediaTagsInput").value.split(",").map(t => t.trim()).filter(Boolean);
  const published = document.getElementById("mediaPublishedInput").checked;
  if (!url) { renderAlert(alertHost, "Paste a link first."); return; }
  if (!/^https?:\/\//i.test(url)) { renderAlert(alertHost, "That doesn't look like a valid link (must start with http:// or https://)."); return; }
  if (!title) { renderAlert(alertHost, "Title is required."); return; }

  const btn = document.getElementById("mediaUploadBtn");
  setBtnLoading(btn, true);
  try {
    const link = parseMediaLink(url);
    await db.collection("media").add({
      title, category, tags, published,
      url, linkType: link.type,
      createdAtMs: Date.now(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast("Resource added.", "success");
    document.getElementById("mediaUrlInput").value = "";
    document.getElementById("mediaTitleInput").value = "";
    document.getElementById("mediaTagsInput").value = "";
    refreshAdminMediaGrid();
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err));
  } finally {
    setBtnLoading(btn, false, "Add resource");
  }
});

function openAdminMediaEditor(item) {
  openAdminModal(
    '<h3 style="margin-bottom:16px;">Edit resource</h3><div id="mediaEditAlert"></div>' +
    '<div class="field"><label>Link</label><input type="text" id="mediaEditUrl" value="' + escapeAttr(item.url || "") + '"></div>' +
    '<div class="field"><label>Title</label><input type="text" id="mediaEditTitle" value="' + escapeAttr(item.title) + '"></div>' +
    '<div class="field"><label>Category</label><select id="mediaEditCategory">' +
    MEDIA_CATEGORIES.map(c => '<option value="' + c + '" ' + (item.category === c ? "selected" : "") + '>' + c + '</option>').join("") + '</select></div>' +
    '<div class="field"><label>Tags (comma separated)</label><input type="text" id="mediaEditTags" value="' + escapeAttr((item.tags || []).join(", ")) + '"></div>' +
    '<div class="field"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="mediaEditPublished" ' + (item.published ? "checked" : "") + ' style="width:auto;"> Published</label></div>' +
    '<div style="display:flex; gap:8px;"><button class="btn btn-primary" id="mediaEditSaveBtn">Save</button><button class="btn btn-danger" id="mediaEditDeleteBtn">Remove resource</button></div>',
    () => {
      document.getElementById("mediaEditSaveBtn").addEventListener("click", async () => {
        const alertHost = document.getElementById("mediaEditAlert");
        const newUrl = document.getElementById("mediaEditUrl").value.trim();
        try {
          await db.collection("media").doc(item.id).update({
            url: newUrl,
            linkType: parseMediaLink(newUrl).type,
            title: document.getElementById("mediaEditTitle").value.trim(),
            category: document.getElementById("mediaEditCategory").value,
            tags: document.getElementById("mediaEditTags").value.split(",").map(t => t.trim()).filter(Boolean),
            published: document.getElementById("mediaEditPublished").checked,
          });
          showToast("Resource updated.", "success");
          closeAdminModal();
          refreshAdminMediaGrid();
        } catch (err) { renderAlert(alertHost, describeFirebaseError(err)); }
      });
      document.getElementById("mediaEditDeleteBtn").addEventListener("click", async () => {
        if (!confirm("Remove this resource from the library? (The file itself, if any, is untouched — this only removes the listing.)")) return;
        try {
          await db.collection("media").doc(item.id).delete();
          showToast("Resource removed.", "success");
          closeAdminModal();
          refreshAdminMediaGrid();
        } catch (err) { showToast(describeFirebaseError(err), "error"); }
      });
    }
  );
}

/* ---------------------------------------------------------
   7. Activities CRUD (8 tailored editors)
   --------------------------------------------------------- */
let __adminLevelsCache = [];
const ACTIVITY_TYPE_LABEL = {
  quiz: "Quiz", match: "Word match", fill: "Fill in the blank", lesson: "Lesson",
  flashcards: "Flashcards", listening: "Listening", reading: "Reading", sentenceBuilder: "Sentence builder",
  memoryFlip: "Memory flip", wordScramble: "Word scramble", speedRound: "Speed round", picturePop: "Picture pop",
  oddOneOut: "Odd one out", sentenceOrder: "Sentence order", listenType: "Listen and type", categorize: "Categorize",
};
const DEFAULT_XP_BY_TYPE = { quiz: 20, match: 15, fill: 15, lesson: 25, flashcards: 15, listening: 25, reading: 25, sentenceBuilder: 20, memoryFlip: 20, wordScramble: 15, speedRound: 25, picturePop: 15, oddOneOut: 15, sentenceOrder: 20, listenType: 20, categorize: 15 };

async function loadActivitiesPanel() {
  const select = document.getElementById("activityLevelSelect");
  try {
    const snap = await db.collection("levels").get();
    __adminLevelsCache = [];
    snap.forEach(doc => __adminLevelsCache.push({ id: doc.id, ...doc.data() }));
    __adminLevelsCache.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!__adminLevelsCache.length) {
      select.innerHTML = '<option value="">Create a level first</option>';
      document.getElementById("activitiesListHost").innerHTML = '<div class="empty-state"><h3>No levels yet</h3><p>Create a level before adding activities.</p></div>';
      return;
    }
    const prevVal = select.value;
    select.innerHTML = __adminLevelsCache.map(l => '<option value="' + l.id + '">' + escapeHtml(l.title) + '</option>').join("");
    select.value = prevVal && __adminLevelsCache.some(l => l.id === prevVal) ? prevVal : __adminLevelsCache[0].id;
    loadActivitiesList();
  } catch (err) {
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadActivitiesPanel });
  }
}
document.getElementById("activityLevelSelect").addEventListener("change", loadActivitiesList);
document.querySelectorAll("[data-new-activity]").forEach(btn => {
  btn.addEventListener("click", () => openActivityEditor(null, btn.getAttribute("data-new-activity")));
});

async function loadActivitiesList() {
  const levelId = document.getElementById("activityLevelSelect").value;
  const host = document.getElementById("activitiesListHost");
  if (!levelId) { host.innerHTML = ""; return; }
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading activities…</div>';
  try {
    const snap = await db.collection("activities").where("levelId", "==", levelId).get();
    const acts = [];
    snap.forEach(doc => acts.push({ id: doc.id, ...doc.data() }));
    acts.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!acts.length) {
      host.innerHTML = '<div class="empty-state"><h3>No activities in this level yet</h3><p>Use the buttons above to add one.</p></div>';
      return;
    }
    host.innerHTML = acts.map((a, i) =>
      '<div class="card" data-act-id="' + a.id + '">' +
      '<div class="card-row">' +
      '<div><h3 style="margin-bottom:2px;">' + escapeHtml(a.title) + ' <span class="badge ' + (a.published ? "badge-published" : "badge-draft") + '">' + (a.published ? "Published" : "Draft") + '</span>' +
      (a.required === false ? ' <span class="badge badge-draft">Optional</span>' : ' <span class="badge badge-published">Required</span>') + '</h3>' +
      '<p style="color:var(--ink-soft); margin:0;">' + (ACTIVITY_TYPE_LABEL[a.type] || a.type) + ' · Order ' + (a.order || 0) + ' · ⚡ ' + (a.xpReward || DEFAULT_XP_BY_TYPE[a.type] || 10) + ' EXP</p></div>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
      (i > 0 ? '<button class="btn btn-ghost btn-sm" data-move-act-up="' + a.id + '" title="Move up">↑</button>' : '') +
      (i < acts.length - 1 ? '<button class="btn btn-ghost btn-sm" data-move-act-down="' + a.id + '" title="Move down">↓</button>' : '') +
      '<button class="btn btn-ghost btn-sm" data-preview-act="' + a.id + '">Preview</button>' +
      '<button class="btn btn-secondary btn-sm" data-dup-act="' + a.id + '">Duplicate</button>' +
      '<button class="btn btn-secondary btn-sm" data-edit-act="' + a.id + '">Edit</button>' +
      '<button class="btn btn-danger btn-sm" data-delete-act="' + a.id + '">Delete</button>' +
      '</div></div></div>'
    ).join("");
    host.querySelectorAll("[data-edit-act]").forEach(btn =>
      btn.addEventListener("click", () => openActivityEditor(acts.find(a => a.id === btn.getAttribute("data-edit-act")), null))
    );
    host.querySelectorAll("[data-delete-act]").forEach(btn =>
      btn.addEventListener("click", () => deleteActivity(btn.getAttribute("data-delete-act")))
    );
    host.querySelectorAll("[data-dup-act]").forEach(btn =>
      btn.addEventListener("click", () => duplicateActivity(acts.find(a => a.id === btn.getAttribute("data-dup-act"))))
    );
    host.querySelectorAll("[data-preview-act]").forEach(btn =>
      btn.addEventListener("click", () => window.open("index.html?previewActivityId=" + btn.getAttribute("data-preview-act"), "_blank"))
    );
    // Reorder via explicit Up/Down buttons rather than HTML5 drag-and-drop:
    // dragging a whole card (no dedicated handle) is exactly the kind of
    // interaction that behaves unreliably on iPad Safari's touch
    // implementation of the drag API, which is what "can't reorder" was.
    // Swapping two activities' `order` values and reloading the list is
    // simple, reliable everywhere, and matches the button style already
    // used for reordering elsewhere in this admin panel.
    host.querySelectorAll("[data-move-act-up]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-move-act-up");
      const i = acts.findIndex(a => a.id === id);
      if (i <= 0) return;
      const a = acts[i], b = acts[i - 1];
      await Promise.all([
        db.collection("activities").doc(a.id).update({ order: b.order || 0 }),
        db.collection("activities").doc(b.id).update({ order: a.order || 0 })
      ]);
      loadActivitiesList();
    }));
    host.querySelectorAll("[data-move-act-down]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-move-act-down");
      const i = acts.findIndex(a => a.id === id);
      if (i === -1 || i >= acts.length - 1) return;
      const a = acts[i], b = acts[i + 1];
      await Promise.all([
        db.collection("activities").doc(a.id).update({ order: b.order || 0 }),
        db.collection("activities").doc(b.id).update({ order: a.order || 0 })
      ]);
      loadActivitiesList();
    }));
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadActivitiesList });
  }
}

// Generic native-HTML5 drag-and-drop reordering for a list of cards.
// No library needed — just draggable="true" + dragstart/dragover/drop.
// onReorder receives the new ID order and is responsible for persisting it.
function wireDragReorder(container, itemSelector, idAttr, onReorder) {
  let draggedId = null;
  container.querySelectorAll(itemSelector).forEach(el => {
    el.addEventListener("dragstart", () => { draggedId = el.getAttribute(idAttr); el.style.opacity = "0.4"; });
    el.addEventListener("dragend", () => { el.style.opacity = "1"; });
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetId = el.getAttribute(idAttr);
      if (!draggedId || draggedId === targetId) return;
      const items = Array.from(container.querySelectorAll(itemSelector));
      const ids = items.map(x => x.getAttribute(idAttr));
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(targetId);
      ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
      onReorder(ids);
    });
  });
}

async function duplicateActivity(activity) {
  try {
    const clone = JSON.parse(JSON.stringify(activity));
    delete clone.id;
    clone.title = activity.title + " (copy)";
    clone.published = false;
    await db.collection("activities").add(clone);
    showToast("Activity duplicated as a draft.", "success");
    loadActivitiesList();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}

async function deleteActivity(id) {
  if (!confirm("Delete this activity?")) return;
  try {
    await db.collection("activities").doc(id).delete();
    showToast("Activity deleted.", "success");
    loadActivitiesList();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}

function openActivityEditor(activity, forceType, aiPrefill) {
  const isNew = !activity;
  const type = activity ? activity.type : forceType;
  // aiPrefill (optional): { title, payload } from the AI curriculum
  // assistant. Only ever used for a brand-new activity, and only ever
  // fills the editor for the admin to review -- nothing from the AI
  // reaches Firestore until the admin presses this same Save button
  // themselves, same as if they had typed it in by hand.
  const source = activity || (aiPrefill ? { payload: aiPrefill.payload } : null);
  const levelId = document.getElementById("activityLevelSelect").value;
  const defaultXp = (activity && activity.xpReward) || DEFAULT_XP_BY_TYPE[type] || 10;
  const isRowType = type === "quiz" || type === "match" || type === "fill" ||
    type === "memoryFlip" || type === "wordScramble" || type === "speedRound" || type === "picturePop" ||
    type === "oddOneOut" || type === "sentenceOrder" || type === "listenType" || type === "categorize";

  let bodyHtml =
    '<h3 style="margin-bottom:16px;">' + (isNew ? "New " + ACTIVITY_TYPE_LABEL[type] : "Edit " + ACTIVITY_TYPE_LABEL[type]) + '</h3>' +
    '<div id="actEditorAlert"></div>' +
    '<div class="field"><label>Title</label><input type="text" id="actTitleInput" value="' + escapeAttr(activity ? activity.title : (aiPrefill && aiPrefill.title) || "") + '"></div>' +
    '<div class="card-row" style="gap:12px;">' +
    '<div class="field" style="flex:1;"><label>Order</label><input type="number" id="actOrderInput" value="' + (activity ? activity.order : 0) + '"></div>' +
    '<div class="field" style="flex:1;"><label>EXP reward</label><input type="number" id="actXpInput" min="1" max="200" value="' + defaultXp + '"></div>' +
    '</div>' +
    '<div class="field"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="actRequiredInput" ' + (!activity || activity.required !== false ? "checked" : "") + ' style="width:auto;"> Required (student must complete this to unlock the next level)</label></div>' +
    '<div id="actTypeBodyHost"></div>' +
    '<div class="field" style="margin-top:12px;"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="actPublishedInput" ' + (activity && activity.published ? "checked" : "") + ' style="width:auto;"> Published (visible to learners)</label></div>' +
    '<button class="btn btn-primary btn-block" id="saveActBtn">Save activity</button>';

  openAdminModal(bodyHtml, () => {
    const typeBodyHost = document.getElementById("actTypeBodyHost");
    let rows = [];             // quiz / match / fill
    let blocks = [];           // lesson
    let rteControllers = {};   // lesson (richtext/tip/warning blocks)
    let flashcards = [];       // flashcards
    let listeningQuestions = []; // listening / reading
    let readingRte = null;     // reading passage editor
    let sentences = [];        // sentenceBuilder
    let getPayload = () => ({});
    let validate = () => null; // returns an error string, or null if valid

    if (isRowType) {
      if (type === "quiz") {
        rows = source && source.payload && source.payload.questions
          ? source.payload.questions.map(q => ({ text: q.text, options: q.options.slice(), correctIndex: q.correctIndex }))
          : [{ text: "", options: ["", "", "", ""], correctIndex: 0 }];
      } else if (type === "match") {
        rows = source && source.payload && source.payload.pairs
          ? source.payload.pairs.map(p => ({ term: p.term, definition: p.definition }))
          : [{ term: "", definition: "" }];
      } else if (type === "fill") {
        rows = source && source.payload && source.payload.items
          ? source.payload.items.map(i => ({ sentence: i.sentence, answer: i.answer }))
          : [{ sentence: "", answer: "" }];
      } else if (type === "memoryFlip") {
        rows = source && source.payload && source.payload.pairs
          ? source.payload.pairs.map(p => ({ a: p.a, b: p.b }))
          : [{ a: "", b: "" }];
      } else if (type === "wordScramble") {
        rows = source && source.payload && source.payload.words
          ? source.payload.words.map(w => ({ word: w.word, hint: w.hint || "" }))
          : [{ word: "", hint: "" }];
      } else if (type === "speedRound") {
        rows = source && source.payload && source.payload.statements
          ? source.payload.statements.map(st => ({ text: st.text, isTrue: !!st.isTrue }))
          : [{ text: "", isTrue: true }];
      } else if (type === "picturePop") {
        rows = source && source.payload && source.payload.rounds
          ? source.payload.rounds.map(r => ({ word: r.word, correctEmoji: r.correctEmoji, decoyEmojis: (r.decoyEmojis || []).join(" ") }))
          : [{ word: "", correctEmoji: "", decoyEmojis: "" }];
      } else if (type === "oddOneOut") {
        rows = source && source.payload && source.payload.rounds
          ? source.payload.rounds.map(r => ({ words: (r.words || []).join(", "), oddWord: (r.words || [])[r.oddIndex] || "" }))
          : [{ words: "", oddWord: "" }];
      } else if (type === "sentenceOrder") {
        rows = source && source.payload && source.payload.sentences
          ? source.payload.sentences.map(s => ({ words: (s.words || []).join(" "), hint: s.hint || "" }))
          : [{ words: "", hint: "" }];
      } else if (type === "listenType") {
        rows = source && source.payload && source.payload.items
          ? source.payload.items.map(i => ({ text: i.text, lang: i.lang || "en" }))
          : [{ text: "", lang: "en" }];
      } else {
        rows = source && source.payload && source.payload.items
          ? source.payload.items.map(i => ({ word: i.word, category: i.category || "A" }))
          : [{ word: "", category: "A" }];
      }

      const ROW_ADD_LABEL = {
        quiz: "question", match: "pair", fill: "item",
        memoryFlip: "pair", wordScramble: "word", speedRound: "statement", picturePop: "round",
        oddOneOut: "round", sentenceOrder: "sentence", listenType: "word/phrase", categorize: "item"
      };
      typeBodyHost.innerHTML =
        (type === "speedRound"
          ? '<div class="field"><label>Time limit (seconds)</label><input type="number" id="speedSecondsInput" min="10" max="180" value="' +
            (source && source.payload && source.payload.seconds ? source.payload.seconds : 30) + '"></div>'
          : "") +
        (type === "categorize"
          ? '<div class="card-row" style="gap:12px;">' +
            '<div class="field" style="flex:1;"><label>Category A name</label><input type="text" id="catAInput" value="' + escapeAttr((source && source.payload && source.payload.categoryA) || "Category A") + '"></div>' +
            '<div class="field" style="flex:1;"><label>Category B name</label><input type="text" id="catBInput" value="' + escapeAttr((source && source.payload && source.payload.categoryB) || "Category B") + '"></div>' +
            '</div>'
          : "") +
        '<div id="actRowsHost"></div>' +
        '<button class="btn btn-secondary btn-sm" id="addRowBtn" type="button" style="margin-bottom:16px;">+ Add ' + ROW_ADD_LABEL[type] + '</button>';
      const rowsHost = document.getElementById("actRowsHost");

      function renderRows() {
        if (type === "quiz") {
          rowsHost.innerHTML = rows.map((q, i) =>
            '<div class="repeat-row" style="flex-direction:column;">' +
            '<div style="display:flex; width:100%; gap:8px; align-items:flex-start;">' +
            '<div class="field" style="flex:1;"><label>Question ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="text" value="' + escapeAttr(q.text) + '"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>' +
            [0, 1, 2, 3].map(oi =>
              '<div class="field" style="width:100%;"><label><input type="radio" class="correct-radio" name="correct' + i + '" data-qi="' + i + '" data-oi="' + oi + '" ' + (q.correctIndex === oi ? "checked" : "") + '> Option ' + (oi + 1) + (oi === 0 ? " (select the correct one)" : "") + '</label>' +
              '<input type="text" data-qi="' + i + '" data-oi="' + oi + '" data-f="opt" value="' + escapeAttr(q.options[oi] || "") + '"></div>'
            ).join("") + '</div>'
          ).join("");
        } else if (type === "match") {
          rowsHost.innerHTML = rows.map((p, i) =>
            '<div class="repeat-row">' +
            '<div class="field"><label>Term ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="term" value="' + escapeAttr(p.term) + '"></div>' +
            '<div class="field"><label>Definition</label><input type="text" data-qi="' + i + '" data-f="definition" value="' + escapeAttr(p.definition) + '"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "fill") {
          rowsHost.innerHTML = rows.map((it, i) =>
            '<div class="repeat-row">' +
            '<div class="field" style="flex:2;"><label>Sentence ' + (i + 1) + ' (use ___ for the blank)</label><input type="text" data-qi="' + i + '" data-f="sentence" value="' + escapeAttr(it.sentence) + '"></div>' +
            '<div class="field"><label>Answer</label><input type="text" data-qi="' + i + '" data-f="answer" value="' + escapeAttr(it.answer) + '"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "memoryFlip") {
          rowsHost.innerHTML = rows.map((p, i) =>
            '<div class="repeat-row">' +
            '<div class="field"><label>Card A ' + (i + 1) + '<span class="field-hint" style="display:block;">e.g. the English word</span></label><input type="text" data-qi="' + i + '" data-f="a" value="' + escapeAttr(p.a) + '"></div>' +
            '<div class="field"><label>Card B<span class="field-hint" style="display:block;">e.g. its translation, or a matching emoji</span></label><input type="text" data-qi="' + i + '" data-f="b" value="' + escapeAttr(p.b) + '"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "wordScramble") {
          rowsHost.innerHTML = rows.map((w, i) =>
            '<div class="repeat-row">' +
            '<div class="field"><label>Word ' + (i + 1) + '<span class="field-hint" style="display:block;">letters only, no spaces</span></label><input type="text" data-qi="' + i + '" data-f="word" value="' + escapeAttr(w.word) + '"></div>' +
            '<div class="field"><label>Hint <span class="field-hint" style="display:inline;">(optional)</span></label><input type="text" data-qi="' + i + '" data-f="hint" value="' + escapeAttr(w.hint) + '"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "speedRound") {
          rowsHost.innerHTML = rows.map((st, i) =>
            '<div class="repeat-row">' +
            '<div class="field" style="flex:2;"><label>Statement ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="text" value="' + escapeAttr(st.text) + '"></div>' +
            '<div class="field"><label><input type="checkbox" class="speed-true-check" data-qi="' + i + '" ' + (st.isTrue ? "checked" : "") + ' style="width:auto;"> True</label></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "picturePop") {
          rowsHost.innerHTML = rows.map((r, i) =>
            '<div class="repeat-row">' +
            '<div class="field"><label>Word ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="word" value="' + escapeAttr(r.word) + '"></div>' +
            '<div class="field"><label>Correct emoji</label><input type="text" data-qi="' + i + '" data-f="correctEmoji" value="' + escapeAttr(r.correctEmoji) + '" placeholder="🐱"></div>' +
            '<div class="field"><label>Decoy emojis <span class="field-hint" style="display:inline;">(space-separated)</span></label><input type="text" data-qi="' + i + '" data-f="decoyEmojis" value="' + escapeAttr(r.decoyEmojis) + '" placeholder="🐶 🐦 🐟"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "oddOneOut") {
          rowsHost.innerHTML = rows.map((r, i) =>
            '<div class="repeat-row">' +
            '<div class="field" style="flex:2;"><label>Words, round ' + (i + 1) + ' <span class="field-hint" style="display:inline;">(comma-separated, 3 to 5 words)</span></label><input type="text" data-qi="' + i + '" data-f="words" value="' + escapeAttr(r.words) + '" placeholder="Apple, Banana, Car, Grape"></div>' +
            '<div class="field"><label>The odd one out</label><input type="text" data-qi="' + i + '" data-f="oddWord" value="' + escapeAttr(r.oddWord) + '" placeholder="Car"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "sentenceOrder") {
          rowsHost.innerHTML = rows.map((r, i) =>
            '<div class="repeat-row">' +
            '<div class="field" style="flex:2;"><label>Sentence ' + (i + 1) + ' <span class="field-hint" style="display:inline;">(correct word order)</span></label><input type="text" data-qi="' + i + '" data-f="words" value="' + escapeAttr(r.words) + '" placeholder="I like apples"></div>' +
            '<div class="field"><label>Hint <span class="field-hint" style="display:inline;">(optional)</span></label><input type="text" data-qi="' + i + '" data-f="hint" value="' + escapeAttr(r.hint) + '"></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else if (type === "listenType") {
          rowsHost.innerHTML = rows.map((r, i) =>
            '<div class="repeat-row">' +
            '<div class="field" style="flex:2;"><label>Word or phrase ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="text" value="' + escapeAttr(r.text) + '"></div>' +
            '<div class="field"><label>Language spoken</label><select data-qi="' + i + '" data-f="lang" data-select="1">' +
            '<option value="en" ' + (r.lang === "en" ? "selected" : "") + '>English</option>' +
            '<option value="id" ' + (r.lang === "id" ? "selected" : "") + '>Indonesian</option></select></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        } else {
          rowsHost.innerHTML = rows.map((r, i) =>
            '<div class="repeat-row">' +
            '<div class="field" style="flex:2;"><label>Word ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="word" value="' + escapeAttr(r.word) + '"></div>' +
            '<div class="field"><label>Category</label><select data-qi="' + i + '" data-f="category" data-select="1">' +
            '<option value="A" ' + (r.category === "A" ? "selected" : "") + '>Category A</option>' +
            '<option value="B" ' + (r.category === "B" ? "selected" : "") + '>Category B</option></select></div>' +
            '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
          ).join("");
        }
        rowsHost.querySelectorAll("input[type='text']").forEach(inp => inp.addEventListener("input", () => {
          const qi = parseInt(inp.getAttribute("data-qi"), 10);
          const f = inp.getAttribute("data-f");
          if (f === "opt") rows[qi].options[parseInt(inp.getAttribute("data-oi"), 10)] = inp.value;
          else rows[qi][f] = inp.value;
        }));
        rowsHost.querySelectorAll("select[data-select]").forEach(sel => sel.addEventListener("change", () => {
          const qi = parseInt(sel.getAttribute("data-qi"), 10);
          rows[qi][sel.getAttribute("data-f")] = sel.value;
        }));
        rowsHost.querySelectorAll(".correct-radio").forEach(r => r.addEventListener("change", () => {
          rows[parseInt(r.getAttribute("data-qi"), 10)].correctIndex = parseInt(r.getAttribute("data-oi"), 10);
        }));
        rowsHost.querySelectorAll(".speed-true-check").forEach(cb => cb.addEventListener("change", () => {
          rows[parseInt(cb.getAttribute("data-qi"), 10)].isTrue = cb.checked;
        }));
        rowsHost.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
          rows.splice(parseInt(btn.getAttribute("data-remove"), 10), 1);
          renderRows();
        }));
      }
      renderRows();
      document.getElementById("addRowBtn").addEventListener("click", () => {
        if (type === "quiz") rows.push({ text: "", options: ["", "", "", ""], correctIndex: 0 });
        else if (type === "match") rows.push({ term: "", definition: "" });
        else if (type === "fill") rows.push({ sentence: "", answer: "" });
        else if (type === "memoryFlip") rows.push({ a: "", b: "" });
        else if (type === "wordScramble") rows.push({ word: "", hint: "" });
        else if (type === "speedRound") rows.push({ text: "", isTrue: true });
        else if (type === "picturePop") rows.push({ word: "", correctEmoji: "", decoyEmojis: "" });
        else if (type === "oddOneOut") rows.push({ words: "", oddWord: "" });
        else if (type === "sentenceOrder") rows.push({ words: "", hint: "" });
        else if (type === "listenType") rows.push({ text: "", lang: "en" });
        else rows.push({ word: "", category: "A" });
        renderRows();
      });

      getPayload = () => {
        if (type === "quiz") return { questions: rows.map(q => ({ text: q.text, options: q.options, correctIndex: q.correctIndex })) };
        if (type === "match") return { pairs: rows.map(p => ({ term: p.term, definition: p.definition })) };
        if (type === "fill") return { items: rows.map(it => ({ sentence: it.sentence, answer: it.answer })) };
        if (type === "memoryFlip") return { pairs: rows.map(p => ({ a: p.a, b: p.b })) };
        if (type === "wordScramble") return { words: rows.map(w => ({ word: w.word.replace(/\s+/g, ""), hint: w.hint })) };
        if (type === "speedRound") {
          const secondsInput = document.getElementById("speedSecondsInput");
          return {
            statements: rows.map(st => ({ text: st.text, isTrue: !!st.isTrue })),
            seconds: secondsInput ? parseInt(secondsInput.value, 10) || 30 : 30
          };
        }
        if (type === "picturePop") return { rounds: rows.map(r => ({ word: r.word, correctEmoji: r.correctEmoji, decoyEmojis: r.decoyEmojis.split(/\s+/).filter(Boolean) })) };
        if (type === "oddOneOut") return {
          rounds: rows.map(r => {
            const words = r.words.split(",").map(w => w.trim()).filter(Boolean);
            const oddIndex = words.findIndex(w => w.toLowerCase() === r.oddWord.trim().toLowerCase());
            return { words, oddIndex: oddIndex === -1 ? 0 : oddIndex };
          })
        };
        if (type === "sentenceOrder") return { sentences: rows.map(r => ({ words: r.words.trim().split(/\s+/).filter(Boolean), hint: r.hint })) };
        if (type === "listenType") return { items: rows.map(r => ({ text: r.text, lang: r.lang || "en" })) };
        return {
          categoryA: (document.getElementById("catAInput") || {}).value || "Category A",
          categoryB: (document.getElementById("catBInput") || {}).value || "Category B",
          items: rows.map(r => ({ word: r.word, category: r.category || "A" }))
        };
      };
      validate = () => {
        if (!rows.length) return "Add at least one item.";
        if (type === "picturePop" && rows.some(r => !r.correctEmoji || !r.decoyEmojis.trim())) {
          return "Every round needs a correct emoji and at least one decoy emoji.";
        }
        if (type === "oddOneOut" && rows.some(r => {
          const words = r.words.split(",").map(w => w.trim()).filter(Boolean);
          return words.length < 3 || !words.some(w => w.toLowerCase() === r.oddWord.trim().toLowerCase());
        })) {
          return "Every round needs at least 3 words, and the odd word must exactly match one of them.";
        }
        if (type === "sentenceOrder" && rows.some(r => r.words.trim().split(/\s+/).filter(Boolean).length < 2)) {
          return "Every sentence needs at least 2 words.";
        }
        return null;
      };

    } else if (type === "lesson") {
      blocks = activity && activity.payload && activity.payload.blocks ? JSON.parse(JSON.stringify(activity.payload.blocks)) : [];
      typeBodyHost.innerHTML = '<div class="add-block-row">' +
        Object.keys(BLOCK_TYPE_LABELS).map(t => '<button type="button" class="add-block-btn" data-add-block="' + t + '">+ ' + BLOCK_TYPE_LABELS[t] + '</button>').join("") +
        '</div><div class="block-editor-list" id="actBlockEditorList"></div>';

      function syncRte() {
        Object.keys(rteControllers).forEach(i => {
          const idx = parseInt(i, 10);
          if (blocks[idx] && rteControllers[idx]) blocks[idx].html = rteControllers[idx].getHtml();
        });
      }
      function renderBlocks() {
        const listHost = document.getElementById("actBlockEditorList");
        rteControllers = {};
        if (!blocks.length) {
          listHost.innerHTML = '<div class="empty-state"><h3>No blocks yet</h3><p>Use the buttons above to build this lesson.</p></div>';
          return;
        }
        listHost.innerHTML = blocks.map((b, i) => blockEditorItemHtml(b, i)).join("");
        blocks.forEach((b, i) => {
          const bodyHost = listHost.querySelector('[data-block-body="' + i + '"]');
          if (!bodyHost) return;
          if (b.type === "richtext" || b.type === "tip" || b.type === "warning") {
            rteControllers[i] = createRichTextEditor(bodyHost.querySelector(".rte-mount"), b.html);
          } else if (b.type === "heading") {
            bodyHost.querySelector(".block-heading-text").addEventListener("input", (e) => { blocks[i].text = e.target.value; });
            bodyHost.querySelector(".block-heading-level").addEventListener("change", (e) => { blocks[i].level = e.target.value; });
          } else if (b.type === "image") {
            bodyHost.querySelector(".block-image-url").addEventListener("input", (e) => { blocks[i].url = e.target.value; });
            bodyHost.querySelector(".block-image-caption").addEventListener("input", (e) => { blocks[i].caption = e.target.value; });
          } else if (b.type === "youtube" || b.type === "slides") {
            bodyHost.querySelector(".block-embed-url").addEventListener("input", (e) => { blocks[i].url = e.target.value; });
          } else if (b.type === "accordion") {
            wireAccordionBlockEditor(bodyHost, blocks[i]);
          } else if (b.type === "quiz") {
            wireQuizBlockEditor(bodyHost, blocks[i]);
          }
        });
        listHost.querySelectorAll("[data-move-up]").forEach(btn => btn.addEventListener("click", () => {
          syncRte();
          const i = parseInt(btn.getAttribute("data-move-up"), 10);
          if (i > 0) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; renderBlocks(); }
        }));
        listHost.querySelectorAll("[data-move-down]").forEach(btn => btn.addEventListener("click", () => {
          syncRte();
          const i = parseInt(btn.getAttribute("data-move-down"), 10);
          if (i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; renderBlocks(); }
        }));
        listHost.querySelectorAll("[data-remove-block]").forEach(btn => btn.addEventListener("click", () => {
          syncRte();
          blocks.splice(parseInt(btn.getAttribute("data-remove-block"), 10), 1);
          renderBlocks();
        }));
      }
      document.querySelectorAll("[data-add-block]").forEach(btn => btn.addEventListener("click", () => {
        syncRte();
        blocks.push(defaultBlock(btn.getAttribute("data-add-block")));
        renderBlocks();
      }));
      renderBlocks();

      getPayload = () => { syncRte(); return { blocks }; };
      validate = () => (!blocks.length ? "Add at least one block." : null);

    } else if (type === "flashcards") {
      flashcards = activity && activity.payload && activity.payload.cards
        ? activity.payload.cards.map(c => ({ front: c.front, back: c.back }))
        : [{ front: "", back: "" }];
      typeBodyHost.innerHTML = '<div id="fcRowsHost"></div><button class="btn btn-secondary btn-sm" id="addFcBtn" type="button" style="margin-bottom:16px;">+ Add card</button>';
      const fcHost = document.getElementById("fcRowsHost");
      function renderFc() {
        fcHost.innerHTML = flashcards.map((c, i) =>
          '<div class="repeat-row">' +
          '<div class="field"><label>Front ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="front" value="' + escapeAttr(c.front) + '"></div>' +
          '<div class="field"><label>Back</label><input type="text" data-qi="' + i + '" data-f="back" value="' + escapeAttr(c.back) + '"></div>' +
          '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
        ).join("");
        fcHost.querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => {
          flashcards[parseInt(inp.getAttribute("data-qi"), 10)][inp.getAttribute("data-f")] = inp.value;
        }));
        fcHost.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
          flashcards.splice(parseInt(btn.getAttribute("data-remove"), 10), 1);
          renderFc();
        }));
      }
      renderFc();
      document.getElementById("addFcBtn").addEventListener("click", () => { flashcards.push({ front: "", back: "" }); renderFc(); });
      getPayload = () => ({ cards: flashcards });
      validate = () => (!flashcards.length ? "Add at least one card." : null);

    } else if (type === "listening" || type === "reading") {
      listeningQuestions = source && source.payload && source.payload.questions
        ? activity.payload.questions.map(q => ({ text: q.text, options: q.options.slice(), correctIndex: q.correctIndex }))
        : [{ text: "", options: ["", "", "", ""], correctIndex: 0 }];

      if (type === "listening") {
        typeBodyHost.innerHTML = '<div class="field"><label>Audio link (direct URL, or a Google Drive/Dropbox direct-download link)</label><input type="text" id="listeningAudioInput" value="' + escapeAttr(activity && activity.payload ? activity.payload.audioUrl || "" : "") + '"></div>' +
          '<h4 style="margin:16px 0 8px;">Comprehension questions</h4><div id="lrQuizWrap"><div class="quiz-block-editor-host"></div></div><button type="button" class="btn btn-ghost btn-sm" id="addLrQBtn">+ Add question</button>';
      } else {
        typeBodyHost.innerHTML = '<div class="field"><label>Reading passage</label><div id="readingRteMount"></div></div>' +
          '<h4 style="margin:16px 0 8px;">Comprehension questions</h4><div id="lrQuizWrap"><div class="quiz-block-editor-host"></div></div><button type="button" class="btn btn-ghost btn-sm" id="addLrQBtn">+ Add question</button>';
        readingRte = createRichTextEditor(document.getElementById("readingRteMount"), activity && activity.payload ? activity.payload.passageHtml : "");
      }
      const lrBlockShim = { questions: listeningQuestions };
      wireQuizBlockEditor(document.getElementById("lrQuizWrap"), lrBlockShim);
      document.getElementById("addLrQBtn").addEventListener("click", () => {
        lrBlockShim.questions.push({ text: "", options: ["", "", "", ""], correctIndex: 0 });
        wireQuizBlockEditor(document.getElementById("lrQuizWrap"), lrBlockShim);
      });

      getPayload = () => type === "listening"
        ? { audioUrl: document.getElementById("listeningAudioInput").value.trim(), questions: lrBlockShim.questions }
        : { passageHtml: readingRte.getHtml(), questions: lrBlockShim.questions };
      validate = () => (!lrBlockShim.questions.length ? "Add at least one question." : null);

    } else if (type === "sentenceBuilder") {
      sentences = activity && activity.payload && activity.payload.sentences
        ? activity.payload.sentences.map(s => ({ text: s.words.join(" "), alternates: (s.alternates || []).map(a => a.join(" ")).join("\n") }))
        : [{ text: "", alternates: "" }];
      typeBodyHost.innerHTML = '<div id="sbRowsHost"></div><button class="btn btn-secondary btn-sm" id="addSbBtn" type="button" style="margin-bottom:16px;">+ Add sentence</button>';
      const sbHost = document.getElementById("sbRowsHost");
      function renderSb() {
        sbHost.innerHTML = sentences.map((s, i) =>
          '<div class="repeat-row" style="flex-direction:column; align-items:stretch;">' +
          '<div style="display:flex; gap:8px;"><div class="field" style="flex:1; margin-bottom:6px;"><label>Sentence ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="text" placeholder="Words in the correct order" value="' + escapeAttr(s.text) + '"></div>' +
          '<button type="button" class="remove-row-btn" data-remove="' + i + '" style="margin-top:22px;">✕</button></div>' +
          '<label style="font-size:0.78rem; color:var(--ink-soft); margin-bottom:4px;">Alternate accepted orders (optional, one per line)</label>' +
          '<textarea data-qi="' + i + '" data-f="alternates" rows="2" style="width:100%; padding:8px 10px; border:1.5px solid var(--line-strong); border-radius:8px;">' + escapeHtml(s.alternates) + '</textarea></div>'
        ).join("");
        sbHost.querySelectorAll("[data-f='text']").forEach(inp => inp.addEventListener("input", () => { sentences[parseInt(inp.getAttribute("data-qi"), 10)].text = inp.value; }));
        sbHost.querySelectorAll("[data-f='alternates']").forEach(ta => ta.addEventListener("input", () => { sentences[parseInt(ta.getAttribute("data-qi"), 10)].alternates = ta.value; }));
        sbHost.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => { sentences.splice(parseInt(btn.getAttribute("data-remove"), 10), 1); renderSb(); }));
      }
      renderSb();
      document.getElementById("addSbBtn").addEventListener("click", () => { sentences.push({ text: "", alternates: "" }); renderSb(); });

      getPayload = () => ({
        sentences: sentences.filter(s => s.text.trim()).map(s => ({
          words: s.text.trim().split(/\s+/),
          alternates: s.alternates.split("\n").map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)),
        })),
      });
      validate = () => (!sentences.some(s => s.text.trim()) ? "Add at least one sentence." : null);
    }

    document.getElementById("saveActBtn").addEventListener("click", async () => {
      const alertHost = document.getElementById("actEditorAlert");
      const title = document.getElementById("actTitleInput").value.trim();
      if (!title) { renderAlert(alertHost, "Title is required."); return; }
      const validationError = validate();
      if (validationError) { renderAlert(alertHost, validationError); return; }

      const data = {
        type, levelId, title,
        order: parseInt(document.getElementById("actOrderInput").value, 10) || 0,
        xpReward: Math.max(1, Math.min(200, parseInt(document.getElementById("actXpInput").value, 10) || defaultXp)),
        required: document.getElementById("actRequiredInput").checked,
        published: document.getElementById("actPublishedInput").checked,
        payload: getPayload(),
      };

      const btn = document.getElementById("saveActBtn");
      setBtnLoading(btn, true);
      try {
        if (isNew) await db.collection("activities").add(data);
        else await db.collection("activities").doc(activity.id).update(data);
        showToast("Activity saved.", "success");
        closeAdminModal();
        loadActivitiesList();
      } catch (err) {
        renderAlert(alertHost, describeFirebaseError(err));
      } finally {
        setBtnLoading(btn, false, "Save activity");
      }
    });
  });
}

/* ---------------------------------------------------------
   7b. Lessons CRUD — block-based lesson editor
   --------------------------------------------------------- */
const LESSON_CATEGORIES = ["Grammar", "Vocabulary", "Speaking", "Writing", "Reading", "Listening", "IELTS", "TOEFL", "MUN", "Business English"];
const LESSON_DIFFICULTIES = ["Beginner", "Elementary", "Intermediate", "Advanced", "Expert"];
const BLOCK_TYPE_LABELS = {
  heading: "Heading", richtext: "Rich Text", divider: "Divider", image: "Image",
  youtube: "YouTube", slides: "Slides / Canva", tip: "Tip Box", warning: "Warning Box",
  accordion: "Accordion", quiz: "Quiz",
};

function defaultBlock(type) {
  switch (type) {
    case "heading": return { type: "heading", text: "", level: "h2" };
    case "richtext": return { type: "richtext", html: "<p></p>" };
    case "divider": return { type: "divider" };
    case "image": return { type: "image", url: "", caption: "" };
    case "youtube": return { type: "youtube", url: "" };
    case "slides": return { type: "slides", url: "" };
    case "tip": return { type: "tip", html: "<p></p>" };
    case "warning": return { type: "warning", html: "<p></p>" };
    case "accordion": return { type: "accordion", items: [{ title: "", content: "" }] };
    case "quiz": return { type: "quiz", questions: [{ text: "", options: ["", "", "", ""], correctIndex: 0 }] };
    default: return { type };
  }
}

function computeReadingMinutesAdmin(blocks) {
  let words = 0;
  (blocks || []).forEach(b => {
    const div = document.createElement("div");
    if (b.type === "richtext" || b.type === "tip" || b.type === "warning") div.innerHTML = b.html || "";
    else if (b.type === "heading") div.textContent = b.text || "";
    else if (b.type === "accordion") (b.items || []).forEach(it => { div.innerHTML += " " + (it.title || "") + " " + (it.content || ""); });
    words += (div.textContent || "").trim().split(/\s+/).filter(Boolean).length;
  });
  return Math.max(1, Math.round(words / 200));
}

let __allLessonsAdminCache = [];

async function loadLessonsPanel() {
  const host = document.getElementById("lessonsListHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading lessons…</div>';
  try {
    const snap = await db.collection("lessons").get();
    __allLessonsAdminCache = [];
    snap.forEach(doc => __allLessonsAdminCache.push({ id: doc.id, ...doc.data() }));
    __allLessonsAdminCache.sort((a, b) => (a.order || 0) - (b.order || 0));
    renderLessonsList();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadLessonsPanel });
  }
}

function renderLessonsList() {
  const host = document.getElementById("lessonsListHost");
  const search = (document.getElementById("adminLessonSearchInput").value || "").toLowerCase();
  const items = __allLessonsAdminCache.filter(l => !search || l.title.toLowerCase().includes(search));
  if (!items.length) {
    host.innerHTML = '<div class="empty-state"><h3>No lessons yet</h3><p>Click "+ New lesson" to build your first one.</p></div>';
    return;
  }
  host.innerHTML = items.map((l, i) =>
    '<div class="card"><div class="card-row">' +
    '<div><h3 style="margin-bottom:2px;">' + escapeHtml(l.title) + ' <span class="badge ' + (l.published ? "badge-published" : "badge-draft") + '">' + (l.published ? "Published" : "Draft") + '</span></h3>' +
    '<p style="color:var(--ink-soft); margin:0;">' + escapeHtml(l.category || "") + ' · ' + escapeHtml(l.difficulty || "") + ' · ' + (l.blocks || []).length + ' blocks · ⏱️ ' + (l.estimatedMinutes || 1) + ' min · ⚡ ' + (l.xpReward || 25) + ' EXP</p></div>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
    (i > 0 ? '<button class="btn btn-ghost btn-sm" data-move-lesson-up="' + l.id + '" title="Move up">↑</button>' : '') +
    (i < items.length - 1 ? '<button class="btn btn-ghost btn-sm" data-move-lesson-down="' + l.id + '" title="Move down">↓</button>' : '') +
    '<button class="btn btn-ghost btn-sm" data-preview-lesson="' + l.id + '">Preview</button>' +
    '<button class="btn btn-secondary btn-sm" data-dup-lesson="' + l.id + '">Duplicate</button>' +
    '<button class="btn btn-secondary btn-sm" data-edit-lesson="' + l.id + '">Edit</button>' +
    '<button class="btn btn-danger btn-sm" data-delete-lesson="' + l.id + '">Delete</button>' +
    '</div></div></div>'
  ).join("");
  host.querySelectorAll("[data-edit-lesson]").forEach(btn =>
    btn.addEventListener("click", () => openLessonEditor(__allLessonsAdminCache.find(l => l.id === btn.getAttribute("data-edit-lesson"))))
  );
  host.querySelectorAll("[data-delete-lesson]").forEach(btn =>
    btn.addEventListener("click", () => deleteLesson(btn.getAttribute("data-delete-lesson")))
  );
  host.querySelectorAll("[data-preview-lesson]").forEach(btn =>
    btn.addEventListener("click", () => window.open("index.html?previewLessonId=" + btn.getAttribute("data-preview-lesson"), "_blank"))
  );
  host.querySelectorAll("[data-dup-lesson]").forEach(btn =>
    btn.addEventListener("click", () => duplicateLesson(__allLessonsAdminCache.find(l => l.id === btn.getAttribute("data-dup-lesson"))))
  );
  // Lessons had no reorder mechanism at all before this -- not even
  // broken drag -- just a sort-by-`order` field nothing ever changed.
  // Swapping adjacent `order` values via explicit buttons, matching
  // the same fix just applied to Activities.
  host.querySelectorAll("[data-move-lesson-up]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-move-lesson-up");
    const i = items.findIndex(l => l.id === id);
    if (i <= 0) return;
    const a = items[i], b = items[i - 1];
    await Promise.all([
      db.collection("lessons").doc(a.id).update({ order: b.order || 0 }),
      db.collection("lessons").doc(b.id).update({ order: a.order || 0 })
    ]);
    loadLessonsPanel();
  }));
  host.querySelectorAll("[data-move-lesson-down]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-move-lesson-down");
    const i = items.findIndex(l => l.id === id);
    if (i === -1 || i >= items.length - 1) return;
    const a = items[i], b = items[i + 1];
    await Promise.all([
      db.collection("lessons").doc(a.id).update({ order: b.order || 0 }),
      db.collection("lessons").doc(b.id).update({ order: a.order || 0 })
    ]);
    loadLessonsPanel();
  }));
}
document.getElementById("adminLessonSearchInput").addEventListener("input", renderLessonsList);

async function duplicateLesson(lesson) {
  try {
    const clone = JSON.parse(JSON.stringify(lesson));
    delete clone.id;
    clone.title = lesson.title + " (copy)";
    clone.published = false;
    await db.collection("lessons").add(clone);
    showToast("Lesson duplicated as a draft.", "success");
    loadLessonsPanel();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}
document.getElementById("newLessonBtn").addEventListener("click", () => openLessonEditor(null));

async function deleteLesson(id) {
  if (!confirm("Delete this lesson?")) return;
  try {
    await db.collection("lessons").doc(id).delete();
    showToast("Lesson deleted.", "success");
    loadLessonsPanel();
  } catch (err) {
    showToast(describeFirebaseError(err), "error");
  }
}

/* ---------------------------------------------------------
   Command Panel: write a lesson as plain tagged text instead of
   clicking through the block editor by hand. Designed specifically so
   an outside AI (ChatGPT, Claude, whatever) can generate it too --
   the syntax guide below is meant to be copied straight into a chat.
   --------------------------------------------------------- */
const COMMAND_SYNTAX_GUIDE =
`Write a JessEDU lesson using this exact plain-text format. Follow it precisely -- every tag is a square-bracketed word in capitals, like [HEADING] or [QUIZ].

Start with these header lines (all optional except TITLE):
TITLE: The lesson's title
CATEGORY: one of Grammar, Vocabulary, Speaking, Writing, Reading, Listening, IELTS, TOEFL, MUN, Business English
DIFFICULTY: one of Beginner, Elementary, Intermediate, Advanced, Expert
MINUTES: a number, how many minutes the lesson takes
EXP: a number, how much EXP completing it awards

Then any number of these blocks, in the order you want them to appear:

[HEADING] Your heading text
  A large section heading, on the same line as the tag.

[HEADING3] Your smaller heading text
  A smaller sub-heading, on the same line as the tag.

[TEXT]
  A paragraph of normal lesson content. Everything until the next [TAG]
  line is one text block. Leave a blank line between separate
  paragraphs. You can use **word** for bold and *word* for italic.

[TIP]
  Same rules as [TEXT], but shown as a highlighted tip box.

[WARNING]
  Same rules as [TEXT], but shown as a highlighted warning box.

[DIVIDER]
  A plain horizontal divider line. No content after it.

[ACCORDION]
- First item title: its content
- Second item title: its content
  One "- Title: Content" per line. As many lines as you want.

[QUIZ]
Q: The question text
A: A wrong answer
A: The correct answer *
A: Another wrong answer
A: Another wrong answer
  Start each question with "Q:". Follow it with exactly four "A:" lines,
  one per option. Put a single * right after the correct one. You can
  repeat Q:/A:/A:/A:/A: as many times as you want for more questions.

Write the whole lesson now using only this format, nothing else around it.`;

const COMMAND_EXAMPLE_TEXT =
`TITLE: Colors
CATEGORY: Vocabulary
DIFFICULTY: Beginner
MINUTES: 5
EXP: 20

[HEADING] Basic Colors
[TEXT]
Colors are some of the first words English learners pick up. Here are a few common ones: **red**, **blue**, **green**, and **yellow**.

Try pointing at things around you and saying their color out loud.

[TIP]
Practice with real objects at home. It's much easier to remember "red apple" than just the word "red" by itself.

[DIVIDER]

[HEADING3] Common Mixups
[WARNING]
Don't confuse *blue* and *blew* — they sound the same but mean completely different things.

[ACCORDION]
- What color is the sky?: Blue, on a clear day.
- What color is grass?: Green, most of the time.

[QUIZ]
Q: Which of these is red?
A: Banana
A: Apple *
A: Sky
A: Grass
Q: Which of these is blue?
A: Grass
A: Apple
A: Sky *
A: Banana`;

function textToRichHtml(raw) {
  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return "<p></p>";
  return paras.map((p) => {
    const h = escapeHtml(p)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    return "<p>" + h + "</p>";
  }).join("");
}

// The actual parser. Deliberately forgiving: unrecognised lines get
// collected as warnings rather than aborting the whole thing, since an
// AI's output might have small quirks worth flagging rather than
// silently dropping the entire lesson over one bad line.
// Shared [TAG]-block parser used by BOTH the Lessons command panel and
// a TYPE: lesson activity in the Activities command panel -- a
// "lesson" is the same block-based content either way, the only
// difference is which collection it's saved to and whether it has a
// levelId attaching it to a level's path.
function parseBlockTagsFromLines(lines) {
  const blocks = [];
  const warnings = [];
  const isTagLine = (l) => /^\s*\[[A-Za-z0-9]+\]/.test(l || "");
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i++; continue; }
    const tagMatch = trimmed.match(/^\[([A-Za-z0-9]+)\]\s*(.*)$/);
    if (!tagMatch) { warnings.push('Ignored a line outside any [TAG]: "' + trimmed.slice(0, 60) + '"'); i++; continue; }
    const tag = tagMatch[1].toUpperCase();
    const rest = tagMatch[2].trim();
    i++;

    if (tag === "HEADING" || tag === "HEADING2") {
      blocks.push({ type: "heading", level: "h2", text: rest });
    } else if (tag === "HEADING3") {
      blocks.push({ type: "heading", level: "h3", text: rest });
    } else if (tag === "DIVIDER") {
      blocks.push({ type: "divider" });
    } else if (tag === "IMAGE") {
      const parts = rest.split("|").map((s) => s.trim());
      blocks.push({ type: "image", url: parts[0] || "", caption: parts[1] || "" });
    } else if (tag === "YOUTUBE") {
      blocks.push({ type: "youtube", url: rest });
    } else if (tag === "TEXT" || tag === "TIP" || tag === "WARNING") {
      const bodyLines = rest ? [rest] : [];
      while (i < lines.length && !isTagLine(lines[i])) { bodyLines.push(lines[i]); i++; }
      const html = textToRichHtml(bodyLines.join("\n"));
      blocks.push({ type: tag === "TEXT" ? "richtext" : tag.toLowerCase(), html });
    } else if (tag === "ACCORDION") {
      const items = [];
      while (i < lines.length && !isTagLine(lines[i])) {
        const itemLine = lines[i].trim(); i++;
        if (!itemLine) continue;
        const m2 = itemLine.match(/^-\s*(.+?):\s*(.+)$/);
        if (m2) items.push({ title: m2[1].trim(), content: m2[2].trim() });
        else warnings.push('Could not read an accordion line (expected "- Title: Content"): "' + itemLine.slice(0, 60) + '"');
      }
      blocks.push({ type: "accordion", items });
    } else if (tag === "QUIZ") {
      const questions = [];
      let current = null;
      while (i < lines.length && !isTagLine(lines[i])) {
        const qLine = lines[i].trim(); i++;
        if (!qLine) continue;
        const qMatch = qLine.match(/^Q:\s*(.+)$/i);
        const aMatch = qLine.match(/^A:\s*(.+)$/i);
        if (qMatch) {
          if (current) questions.push(current);
          current = { text: qMatch[1].trim(), options: [], correctIndex: 0 };
        } else if (aMatch && current) {
          let optText = aMatch[1].trim();
          const isCorrect = /\*\s*$/.test(optText);
          optText = optText.replace(/\*\s*$/, "").trim();
          if (isCorrect) current.correctIndex = current.options.length;
          current.options.push(optText);
        } else {
          warnings.push('Could not read a quiz line (expected "Q: ..." or "A: ..."): "' + qLine.slice(0, 60) + '"');
        }
      }
      if (current) questions.push(current);
      questions.forEach((q) => {
        if (q.options.length !== 4) warnings.push('Question "' + q.text.slice(0, 40) + '" had ' + q.options.length + ' options, not 4 -- padded/trimmed to 4.');
        while (q.options.length < 4) q.options.push("");
        q.options = q.options.slice(0, 4);
      });
      blocks.push({ type: "quiz", questions });
    } else {
      warnings.push("Unknown tag [" + tag + "], skipped.");
    }
  }
  return { blocks, warnings };
}

function parseLessonCommandText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const meta = { title: "", category: LESSON_CATEGORIES[0], difficulty: LESSON_DIFFICULTIES[0], estimatedMinutes: 5, xpReward: 25 };
  const warnings = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line.startsWith("[")) break;
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (m) {
      const key = m[1].toUpperCase(), val = m[2].trim();
      if (key === "TITLE") meta.title = val;
      else if (key === "CATEGORY") meta.category = LESSON_CATEGORIES.find((c) => c.toLowerCase() === val.toLowerCase()) || val;
      else if (key === "DIFFICULTY") meta.difficulty = LESSON_DIFFICULTIES.find((d) => d.toLowerCase() === val.toLowerCase()) || val;
      else if (key === "MINUTES") meta.estimatedMinutes = parseInt(val, 10) || 5;
      else if (key === "EXP") meta.xpReward = parseInt(val, 10) || 25;
    }
    i++;
  }

  const { blocks, warnings: blockWarnings } = parseBlockTagsFromLines(lines.slice(i));
  warnings.push(...blockWarnings);

  if (!meta.title) warnings.push('No "TITLE:" line found — will be saved as "Untitled lesson".');
  if (!blocks.length) warnings.push("No blocks were recognised. Check tags are spelled like [HEADING] or [TEXT] with square brackets.");
  return { meta, blocks, warnings };
}

const COMMAND_BLOCK_PREVIEW_LABEL = {
  heading: "Heading", richtext: "Text", tip: "Tip box", warning: "Warning box",
  divider: "Divider", image: "Image", youtube: "YouTube", accordion: "Accordion", quiz: "Quiz",
};
function renderCommandBlockPreview(block) {
  const label = COMMAND_BLOCK_PREVIEW_LABEL[block.type] || block.type;
  let body = "";
  if (block.type === "heading") body = "<strong>" + escapeHtml(block.text) + "</strong>";
  else if (block.type === "richtext" || block.type === "tip" || block.type === "warning") body = block.html;
  else if (block.type === "divider") body = "<hr>";
  else if (block.type === "image") body = escapeHtml(block.url) + (block.caption ? " — " + escapeHtml(block.caption) : "");
  else if (block.type === "youtube") body = escapeHtml(block.url);
  else if (block.type === "accordion") body = block.items.map((it) => "<p><strong>" + escapeHtml(it.title) + "</strong>: " + escapeHtml(it.content) + "</p>").join("");
  else if (block.type === "quiz") body = block.questions.map((q, qi) =>
    "<p><strong>" + (qi + 1) + ". " + escapeHtml(q.text) + "</strong><br>" +
    q.options.map((o, oi) => (oi === q.correctIndex ? "✓ " : "• ") + escapeHtml(o)).join("<br>") + "</p>"
  ).join("");
  return '<div class="block-editor-item"><div class="block-type-label">' + label + '</div><div class="rte-render">' + body + '</div></div>';
}

let __commandLastParsed = null;
function initCommandPanel() {
  // Three sub-tabs share this one admin panel: Lessons (existing),
  // Levels, and Activities. Only one call happens per admin session
  // since each init function guards itself, same pattern as the rest
  // of this file.
  document.querySelectorAll(".cmd-subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cmd-subtab").forEach((b) => b.classList.toggle("active", b === btn));
      const which = btn.getAttribute("data-cmd-subtab");
      document.getElementById("cmdSubpanelLessons").hidden = which !== "lessons";
      document.getElementById("cmdSubpanelLevels").hidden = which !== "levels";
      document.getElementById("cmdSubpanelActivities").hidden = which !== "activities";
      if (which === "levels") initLevelCommandPanel();
      if (which === "activities") initActivityCommandPanel();
    });
  });
  document.getElementById("copyCommandSyntaxBtn").onclick = () => {
    navigator.clipboard.writeText(COMMAND_SYNTAX_GUIDE).then(
      () => showToast("Syntax guide copied — paste it into an AI chat."),
      () => showToast("Couldn't copy automatically. Select and copy the guide manually.")
    );
  };
  document.getElementById("loadCommandExampleBtn").onclick = () => {
    document.getElementById("commandInputArea").value = COMMAND_EXAMPLE_TEXT;
  };
  document.getElementById("parseCommandBtn").onclick = () => {
    const raw = document.getElementById("commandInputArea").value;
    const parsed = parseLessonCommandText(raw);
    __commandLastParsed = parsed;
    const alertHost = document.getElementById("commandParseAlert");
    const previewHost = document.getElementById("commandPreviewHost");

    alertHost.innerHTML = parsed.warnings.length
      ? '<div class="alert alert-error"><strong>' + parsed.warnings.length + ' thing(s) to check:</strong><ul style="margin:6px 0 0 18px;">' +
        parsed.warnings.map((w) => "<li>" + escapeHtml(w) + "</li>").join("") + "</ul></div>"
      : '<div class="alert alert-success">Parsed cleanly — ' + parsed.blocks.length + " block(s) found.</div>";

    previewHost.innerHTML =
      '<h4 style="margin-bottom:8px;">' + escapeHtml(parsed.meta.title || "(untitled)") + '</h4>' +
      '<p style="color:var(--ink-soft); margin-bottom:14px;">' + escapeHtml(parsed.meta.category) + " · " + escapeHtml(parsed.meta.difficulty) +
      " · " + parsed.meta.estimatedMinutes + " min · ⚡ " + parsed.meta.xpReward + " EXP</p>" +
      parsed.blocks.map(renderCommandBlockPreview).join("") +
      '<button class="btn btn-primary" id="createCommandLessonBtn" style="margin-top:16px;">Create this lesson (as a draft)</button>';

    document.getElementById("createCommandLessonBtn").addEventListener("click", async () => {
      const btn = document.getElementById("createCommandLessonBtn");
      btn.disabled = true; btn.textContent = "Creating…";
      try {
        const snap = await db.collection("lessons").get();
        let maxOrder = 0;
        snap.forEach((d) => { maxOrder = Math.max(maxOrder, (d.data().order || 0)); });
        const doc = await db.collection("lessons").add({
          title: parsed.meta.title || "Untitled lesson",
          category: parsed.meta.category,
          difficulty: parsed.meta.difficulty,
          estimatedMinutes: parsed.meta.estimatedMinutes,
          xpReward: parsed.meta.xpReward,
          blocks: parsed.blocks,
          levelId: "",
          order: maxOrder + 1,
          published: false, // always a draft -- reviewed and published by hand, never auto-live
        });
        showToast("Lesson created as a draft. Opening it for a final look…");
        document.getElementById("commandInputArea").value = "";
        previewHost.innerHTML = ""; alertHost.innerHTML = "";
        const created = await db.collection("lessons").doc(doc.id).get();
        openLessonEditor({ id: created.id, ...created.data() });
      } catch (err) {
        showToast(describeFirebaseError(err));
        btn.disabled = false; btn.textContent = "Create this lesson (as a draft)";
      }
    });
  };
}

const LEVEL_SYNTAX_GUIDE =
`Write a JessEDU level (a chapter in the learning path) using this format. Just a few header lines, no blocks or tags needed.

TITLE: the level's title
DESCRIPTION: a short description of what this level covers
ORDER: a number — lower numbers appear first in the path

Write it now using only this format, nothing else around it.`;

const LEVEL_EXAMPLE_TEXT =
`TITLE: Everyday Words
DESCRIPTION: Learn the words you'll use every single day, at home, at school, and with friends.
ORDER: 2`;

function parseLevelCommandText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const meta = { title: "", description: "", order: 0 };
  const warnings = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const m = trimmed.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!m) { warnings.push('Ignored a line that isn\'t "KEY: value": "' + trimmed.slice(0, 60) + '"'); return; }
    const key = m[1].toUpperCase(), val = m[2].trim();
    if (key === "TITLE") meta.title = val;
    else if (key === "DESCRIPTION") meta.description = val;
    else if (key === "ORDER") meta.order = parseInt(val, 10) || 0;
    else warnings.push('Unknown field "' + key + '", ignored.');
  });
  if (!meta.title) warnings.push('No "TITLE:" line found — will be saved as "Untitled level".');
  return { meta, warnings };
}

function initLevelCommandPanel() {
  if (document.getElementById("copyLevelSyntaxBtn").dataset.wired) return;
  document.getElementById("copyLevelSyntaxBtn").dataset.wired = "1";

  document.getElementById("copyLevelSyntaxBtn").onclick = () => {
    navigator.clipboard.writeText(LEVEL_SYNTAX_GUIDE).then(
      () => showToast("Syntax guide copied — paste it into an AI chat."),
      () => showToast("Couldn't copy automatically. Select and copy the guide manually.")
    );
  };
  document.getElementById("loadLevelExampleBtn").onclick = () => {
    document.getElementById("levelCommandInputArea").value = LEVEL_EXAMPLE_TEXT;
  };
  document.getElementById("parseLevelCommandBtn").onclick = () => {
    const raw = document.getElementById("levelCommandInputArea").value;
    const parsed = parseLevelCommandText(raw);
    const alertHost = document.getElementById("levelCommandParseAlert");
    const previewHost = document.getElementById("levelCommandPreviewHost");

    alertHost.innerHTML = parsed.warnings.length
      ? '<div class="alert alert-error"><strong>' + parsed.warnings.length + ' thing(s) to check:</strong><ul style="margin:6px 0 0 18px;">' +
        parsed.warnings.map((w) => "<li>" + escapeHtml(w) + "</li>").join("") + "</ul></div>"
      : '<div class="alert alert-success">Parsed cleanly.</div>';

    previewHost.innerHTML =
      '<div class="card"><h4 style="margin-bottom:6px;">' + escapeHtml(parsed.meta.title || "(untitled)") + '</h4>' +
      '<p style="color:var(--ink-soft); margin-bottom:8px;">Order: ' + parsed.meta.order + '</p>' +
      '<p>' + escapeHtml(parsed.meta.description || "(no description)") + '</p></div>' +
      '<button class="btn btn-primary" id="createCommandLevelBtn" style="margin-top:16px;">Create this level</button>';

    document.getElementById("createCommandLevelBtn").addEventListener("click", async () => {
      const btn = document.getElementById("createCommandLevelBtn");
      btn.disabled = true; btn.textContent = "Creating…";
      try {
        await db.collection("levels").add({
          title: parsed.meta.title || "Untitled level",
          description: parsed.meta.description || "",
          order: parsed.meta.order,
          published: false,
        });
        showToast("Level created as a draft.");
        document.getElementById("levelCommandInputArea").value = "";
        previewHost.innerHTML = ""; alertHost.innerHTML = "";
      } catch (err) {
        showToast(describeFirebaseError(err));
        btn.disabled = false; btn.textContent = "Create this level";
      }
    });
  };
}

/* ---------------------------------------------------------
   Activity commands: one unified parser for all 15 activity types,
   dispatched on a TYPE: line. Each type has its own small body syntax
   documented in ACTIVITY_SYNTAX_GUIDE below.
   --------------------------------------------------------- */
const ACTIVITY_SYNTAX_GUIDE =
`Write a JessEDU activity using this format. Start with header lines, then a body whose format depends on TYPE.

Header (TITLE and TYPE required, the rest optional):
TITLE: the activity's title
TYPE: one of quiz, match, fill, memoryFlip, wordScramble, speedRound, picturePop, oddOneOut, sentenceOrder, listenType, categorize
LEVEL: the exact title of an existing level to attach this to (optional)
XP: a number, how much EXP completing it awards
SECONDS: only for TYPE: speedRound — the time limit in seconds
CATEGORY_A: only for TYPE: categorize — the first bucket's name
CATEGORY_B: only for TYPE: categorize — the second bucket's name

Then a blank line, then the body, which depends on TYPE:

TYPE: lesson
  Uses the exact same [HEADING], [TEXT], [TIP], [WARNING], [DIVIDER], [ACCORDION], and [QUIZ] tags as a
  standalone lesson (see the Lessons section of this guide). This is what creates real reading content
  INSIDE a level's path, as opposed to the free-browse Library.

TYPE: quiz
Q: the question
A: a wrong option
A: the correct option *
A: a wrong option
A: a wrong option
  Exactly four A: lines per question, one starred with *. Repeat Q:/A:/A:/A:/A: for more questions.

TYPE: match  (or memoryFlip — same body syntax)
PAIR: term = definition
  One per line. For memoryFlip, "term" and "definition" are the two matching cards (e.g. an English word and its Indonesian translation).

TYPE: fill
ITEM: a sentence with ___ for the blank = the answer

TYPE: wordScramble
WORD: word = an optional short hint

TYPE: speedRound
STATEMENT: a statement = true
STATEMENT: another statement = false

TYPE: picturePop
ROUND: word = correct_emoji | decoy_emoji decoy_emoji decoy_emoji

TYPE: oddOneOut
ROUND: word, word, word, word = the odd one out
  3 to 5 comma-separated words, then the exact odd one after the =.

TYPE: sentenceOrder
SENTENCE: the sentence in its correct word order
SENTENCE: another sentence | an optional hint

TYPE: listenType
WORD: the word or phrase = en
WORD: another word = id
  Language is "en" or "id".

TYPE: categorize
ITEM: a word = A
ITEM: another word = B
  "A" and "B" refer to CATEGORY_A and CATEGORY_B from the header.

Write the whole activity now using only this format, nothing else around it.`;

const ACTIVITY_EXAMPLE_TEXT = {
  lesson: `TITLE: Greetings\nTYPE: lesson\nLEVEL: Everyday Words\nXP: 25\n\n[HEADING] Saying Hello\n[TEXT]\nIn English, "hello" and "hi" are the two most common greetings. "Hi" is a little more casual than "hello".\n\n[TIP]\nTry greeting someone new every day, even just in your head, to build the habit.\n\n[QUIZ]\nQ: Which greeting is more casual?\nA: Hello\nA: Hi *\nA: Good morning\nA: Good evening`,
  quiz: `TITLE: Fruit Quiz\nTYPE: quiz\nLEVEL: Everyday Words\nXP: 20\n\nQ: Which one is red?\nA: Apple *\nA: Banana\nA: Grape\nA: Lemon\nQ: Which one is yellow?\nA: Grape\nA: Banana *\nA: Apple\nA: Grape`,
  match: `TITLE: Family Match\nTYPE: match\nLEVEL: Everyday Words\nXP: 15\n\nPAIR: Mother = Ibu\nPAIR: Father = Ayah\nPAIR: Sister = Kakak`,
  fill: `TITLE: Fill the Blank\nTYPE: fill\nLEVEL: Everyday Words\nXP: 15\n\nITEM: I ___ to school every day. = go\nITEM: She ___ a book right now. = is reading`,
  memoryFlip: `TITLE: Word Memory\nTYPE: memoryFlip\nLEVEL: Everyday Words\nXP: 20\n\nPAIR: Cat = Kucing\nPAIR: Dog = Anjing`,
  wordScramble: `TITLE: Scramble Practice\nTYPE: wordScramble\nLEVEL: Everyday Words\nXP: 15\n\nWORD: apple = a red or green fruit\nWORD: school = where you learn`,
  speedRound: `TITLE: True or False\nTYPE: speedRound\nLEVEL: Everyday Words\nXP: 25\nSECONDS: 30\n\nSTATEMENT: The sky is green. = false\nSTATEMENT: Cats can meow. = true`,
  picturePop: `TITLE: Picture Pop\nTYPE: picturePop\nLEVEL: Everyday Words\nXP: 15\n\nROUND: apple = 🍎 | 🍌 🍇 🍋\nROUND: cat = 🐱 | 🐶 🐦 🐟`,
  oddOneOut: `TITLE: Odd One Out\nTYPE: oddOneOut\nLEVEL: Everyday Words\nXP: 15\n\nROUND: Apple, Banana, Car, Grape = Car`,
  sentenceOrder: `TITLE: Sentence Order\nTYPE: sentenceOrder\nLEVEL: Everyday Words\nXP: 20\n\nSENTENCE: I like apples\nSENTENCE: She is my friend | think about who "she" refers to`,
  listenType: `TITLE: Listen and Type\nTYPE: listenType\nLEVEL: Everyday Words\nXP: 20\n\nWORD: apple = en\nWORD: kucing = id`,
  categorize: `TITLE: Animals or Fruits\nTYPE: categorize\nLEVEL: Everyday Words\nXP: 15\nCATEGORY_A: Animals\nCATEGORY_B: Fruits\n\nITEM: Cat = A\nITEM: Apple = B\nITEM: Banana = B\nITEM: Dog = A`,
};

function parseActivityCommandText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const meta = { title: "", type: "", level: "", xp: 15, seconds: 30, categoryA: "Category A", categoryB: "Category B" };
  const bodyLines = [];
  const warnings = [];
  let inBody = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!inBody) {
      if (!trimmed) { inBody = true; return; }
      const m = trimmed.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!m) { inBody = true; bodyLines.push(line); return; }
      const key = m[1].toUpperCase(), val = m[2].trim();
      if (key === "TITLE") meta.title = val;
      else if (key === "TYPE") meta.type = val;
      else if (key === "LEVEL") meta.level = val;
      else if (key === "XP") meta.xp = parseInt(val, 10) || 15;
      else if (key === "SECONDS") meta.seconds = parseInt(val, 10) || 30;
      else if (key === "CATEGORY_A") meta.categoryA = val;
      else if (key === "CATEGORY_B") meta.categoryB = val;
      else warnings.push('Unknown field "' + key + '" in the header, ignored.');
    } else {
      bodyLines.push(line);
    }
  });

  if (!meta.title) warnings.push('No "TITLE:" line found — will be saved as "Untitled activity".');
  if (!ACTIVITY_TYPE_LABEL[meta.type]) {
    warnings.push('No valid "TYPE:" line found (or it doesn\'t match a known type) — cannot build a payload.');
    return { meta, payload: null, warnings };
  }

  const bodyText = bodyLines.join("\n");
  const bodyLinesTrimmed = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
  let payload = null;

  if (meta.type === "lesson") {
    // A "lesson" activity is the same block content (headings, text,
    // tip/warning boxes, accordion, quiz) as a standalone Library
    // lesson -- the only difference is this one has a levelId and
    // lives inside a level's path instead of the free-browse Library.
    const { blocks, warnings: blockWarnings } = parseBlockTagsFromLines(bodyLines);
    warnings.push(...blockWarnings);
    payload = { blocks };
  } else if (meta.type === "quiz") {
    const questions = [];
    let current = null;
    bodyLinesTrimmed.forEach((l) => {
      const q = l.match(/^Q:\s*(.+)$/i), a = l.match(/^A:\s*(.+)$/i);
      if (q) { if (current) questions.push(current); current = { text: q[1].trim(), options: [], correctIndex: 0 }; }
      else if (a && current) {
        let opt = a[1].trim();
        const isCorrect = /\*\s*$/.test(opt);
        opt = opt.replace(/\*\s*$/, "").trim();
        if (isCorrect) current.correctIndex = current.options.length;
        current.options.push(opt);
      } else warnings.push('Could not read a quiz line: "' + l.slice(0, 60) + '"');
    });
    if (current) questions.push(current);
    questions.forEach((q) => {
      if (q.options.length !== 4) warnings.push('Question "' + q.text.slice(0, 40) + '" had ' + q.options.length + ' options, not 4.');
      while (q.options.length < 4) q.options.push("");
      q.options = q.options.slice(0, 4);
    });
    payload = { questions };
  } else if (meta.type === "match" || meta.type === "memoryFlip") {
    const pairs = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^PAIR:\s*(.+?)\s*=\s*(.+)$/i);
      if (m) pairs.push(meta.type === "match" ? { term: m[1].trim(), definition: m[2].trim() } : { a: m[1].trim(), b: m[2].trim() });
      else warnings.push('Could not read a pair line (expected "PAIR: a = b"): "' + l.slice(0, 60) + '"');
    });
    payload = meta.type === "match" ? { pairs } : { pairs };
  } else if (meta.type === "fill") {
    const items = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^ITEM:\s*(.+?)\s*=\s*(.+)$/i);
      if (m) items.push({ sentence: m[1].trim(), answer: m[2].trim() });
      else warnings.push('Could not read an item line (expected "ITEM: sentence = answer"): "' + l.slice(0, 60) + '"');
    });
    payload = { items };
  } else if (meta.type === "wordScramble") {
    const words = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^WORD:\s*(.+?)(?:\s*=\s*(.*))?$/i);
      if (m) words.push({ word: m[1].trim().replace(/\s+/g, ""), hint: (m[2] || "").trim() });
      else warnings.push('Could not read a word line: "' + l.slice(0, 60) + '"');
    });
    payload = { words };
  } else if (meta.type === "speedRound") {
    const statements = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^STATEMENT:\s*(.+?)\s*=\s*(true|false)$/i);
      if (m) statements.push({ text: m[1].trim(), isTrue: m[2].toLowerCase() === "true" });
      else warnings.push('Could not read a statement line (expected "STATEMENT: text = true/false"): "' + l.slice(0, 60) + '"');
    });
    payload = { statements, seconds: meta.seconds };
  } else if (meta.type === "picturePop") {
    const rounds = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^ROUND:\s*(.+?)\s*=\s*(\S+)\s*\|\s*(.+)$/i);
      if (m) rounds.push({ word: m[1].trim(), correctEmoji: m[2].trim(), decoyEmojis: m[3].trim().split(/\s+/).filter(Boolean) });
      else warnings.push('Could not read a round line (expected "ROUND: word = emoji | decoys"): "' + l.slice(0, 60) + '"');
    });
    payload = { rounds };
  } else if (meta.type === "oddOneOut") {
    const rounds = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^ROUND:\s*(.+?)\s*=\s*(.+)$/i);
      if (m) {
        const words = m[1].split(",").map((w) => w.trim()).filter(Boolean);
        const oddIndex = words.findIndex((w) => w.toLowerCase() === m[2].trim().toLowerCase());
        if (words.length < 3 || oddIndex === -1) warnings.push('Round "' + l.slice(0, 50) + '" needs 3+ words and an odd word that exactly matches one of them.');
        rounds.push({ words, oddIndex: oddIndex === -1 ? 0 : oddIndex });
      } else warnings.push('Could not read a round line: "' + l.slice(0, 60) + '"');
    });
    payload = { rounds };
  } else if (meta.type === "sentenceOrder") {
    const sentences = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^SENTENCE:\s*(.+?)(?:\s*\|\s*(.+))?$/i);
      if (m) sentences.push({ words: m[1].trim().split(/\s+/).filter(Boolean), hint: (m[2] || "").trim() });
      else warnings.push('Could not read a sentence line: "' + l.slice(0, 60) + '"');
    });
    payload = { sentences };
  } else if (meta.type === "listenType") {
    const items = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^WORD:\s*(.+?)\s*=\s*(en|id)$/i);
      if (m) items.push({ text: m[1].trim(), lang: m[2].toLowerCase() });
      else warnings.push('Could not read a word line (expected "WORD: text = en" or "= id"): "' + l.slice(0, 60) + '"');
    });
    payload = { items };
  } else if (meta.type === "categorize") {
    const items = [];
    bodyLinesTrimmed.forEach((l) => {
      const m = l.match(/^ITEM:\s*(.+?)\s*=\s*(A|B)$/i);
      if (m) items.push({ word: m[1].trim(), category: m[2].toUpperCase() });
      else warnings.push('Could not read an item line (expected "ITEM: word = A" or "= B"): "' + l.slice(0, 60) + '"');
    });
    payload = { categoryA: meta.categoryA, categoryB: meta.categoryB, items };
  }

  if (payload && Object.values(payload).every((v) => Array.isArray(v) ? v.length === 0 : false)) {
    warnings.push("No body lines were recognised for this type. Check the syntax guide for the exact format.");
  }
  return { meta, payload, warnings };
}

function initActivityCommandPanel() {
  const typeSelect = document.getElementById("activityExampleTypeSelect");
  if (typeSelect.dataset.wired) return;
  typeSelect.dataset.wired = "1";
  typeSelect.innerHTML = Object.keys(ACTIVITY_EXAMPLE_TEXT).map((t) => '<option value="' + t + '">' + escapeHtml(ACTIVITY_TYPE_LABEL[t]) + '</option>').join("");

  document.getElementById("copyActivitySyntaxBtn").onclick = () => {
    navigator.clipboard.writeText(ACTIVITY_SYNTAX_GUIDE).then(
      () => showToast("Syntax guide copied — paste it into an AI chat."),
      () => showToast("Couldn't copy automatically. Select and copy the guide manually.")
    );
  };
  document.getElementById("loadActivityExampleBtn").onclick = () => {
    document.getElementById("activityCommandInputArea").value = ACTIVITY_EXAMPLE_TEXT[typeSelect.value];
  };
  document.getElementById("parseActivityCommandBtn").onclick = async () => {
    const raw = document.getElementById("activityCommandInputArea").value;
    const parsed = parseActivityCommandText(raw);
    const alertHost = document.getElementById("activityCommandParseAlert");
    const previewHost = document.getElementById("activityCommandPreviewHost");

    alertHost.innerHTML = parsed.warnings.length
      ? '<div class="alert alert-error"><strong>' + parsed.warnings.length + ' thing(s) to check:</strong><ul style="margin:6px 0 0 18px;">' +
        parsed.warnings.map((w) => "<li>" + escapeHtml(w) + "</li>").join("") + "</ul></div>"
      : '<div class="alert alert-success">Parsed cleanly.</div>';

    if (!parsed.payload) { previewHost.innerHTML = ""; return; }

    previewHost.innerHTML =
      '<div class="card"><h4 style="margin-bottom:4px;">' + escapeHtml(parsed.meta.title || "(untitled)") + '</h4>' +
      '<p style="color:var(--ink-soft); margin-bottom:10px;">' + escapeHtml(ACTIVITY_TYPE_LABEL[parsed.meta.type]) +
      (parsed.meta.level ? " · attach to \"" + escapeHtml(parsed.meta.level) + "\"" : "") + " · ⚡ " + parsed.meta.xp + " EXP</p>" +
      '<pre style="white-space:pre-wrap; font-size:0.82rem; background:var(--paper-2); padding:10px; border-radius:var(--r-sm);">' +
      escapeHtml(JSON.stringify(parsed.payload, null, 2)) + '</pre></div>' +
      '<button class="btn btn-primary" id="createCommandActivityBtn" style="margin-top:16px;">Create this activity (as a draft)</button>';

    document.getElementById("createCommandActivityBtn").addEventListener("click", async () => {
      const btn = document.getElementById("createCommandActivityBtn");
      btn.disabled = true; btn.textContent = "Creating…";
      try {
        let levelId = "";
        if (parsed.meta.level) {
          const snap = await db.collection("levels").get();
          const allLevels = [];
          snap.forEach((d) => allLevels.push({ id: d.id, title: d.data().title || "" }));
          const wanted = parsed.meta.level.toLowerCase().trim();
          // An exact match first, but a level whose real title has
          // extra decoration around the name typed (e.g. the actual
          // title is "Beginner [Level 1]" but "Beginner" was typed)
          // would silently fail an exact match and the activity would
          // still get created, just invisibly unattached -- which
          // looks exactly like "nothing happened" from the admin
          // side. A "starts with" / "contains" fallback catches that
          // common case; if even that fails, the actual list of level
          // titles is shown so the mismatch is obvious immediately
          // instead of a vague "not found".
          let match = allLevels.find((l) => l.title.toLowerCase().trim() === wanted);
          if (!match) match = allLevels.find((l) => l.title.toLowerCase().includes(wanted) || wanted.includes(l.title.toLowerCase().trim()));
          if (match) {
            levelId = match.id;
            if (match.title.toLowerCase().trim() !== wanted) {
              showToast('Matched "' + parsed.meta.level + '" to the existing level "' + match.title + '".', "info");
            }
          } else {
            const available = allLevels.map((l) => '"' + l.title + '"').join(", ") || "(no levels exist yet)";
            showToast('No level matching "' + parsed.meta.level + '" was found — saved unattached. Existing levels: ' + available, "error");
          }
        }
        // Every activity created here was hardcoded to order: 0 --
        // meaning any two activities made through this panel for the
        // SAME level tied at the same order, which breaks the
        // "complete the previous one to unlock this one" sequencing
        // that depends on a clear, unique order per level. Now it
        // looks up the highest existing order within that same level
        // (unattached activities, order among themselves) and takes
        // the next number, the same way new lessons already do.
        const existingSnap = await db.collection("activities").where("levelId", "==", levelId).get();
        let maxOrder = 0;
        existingSnap.forEach((d) => { maxOrder = Math.max(maxOrder, d.data().order || 0); });
        await db.collection("activities").add({
          title: parsed.meta.title || "Untitled activity",
          type: parsed.meta.type,
          payload: parsed.payload,
          levelId,
          order: maxOrder + 1,
          xpReward: parsed.meta.xp,
          required: true,
          published: false,
        });
        showToast("Activity created as a draft.");
        document.getElementById("activityCommandInputArea").value = "";
        previewHost.innerHTML = ""; alertHost.innerHTML = "";
      } catch (err) {
        showToast(describeFirebaseError(err));
        btn.disabled = false; btn.textContent = "Create this activity (as a draft)";
      }
    });
  };
}


async function openLessonEditor(lesson) {
  const isNew = !lesson;
  let levelsForSelect = [];
  try {
    const snap = await db.collection("levels").get();
    snap.forEach(doc => levelsForSelect.push({ id: doc.id, ...doc.data() }));
    levelsForSelect.sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) { /* level dropdown just stays empty if this fails */ }

  openAdminModal(
    '<h3 style="margin-bottom:16px;">' + (isNew ? "New lesson" : "Edit lesson") + '</h3>' +
    '<div id="lessonEditorAlert"></div>' +
    '<div class="field"><label>Title</label><input type="text" id="lessonTitleInput" value="' + escapeAttr(lesson ? lesson.title : "") + '"></div>' +
    '<div class="card-row" style="gap:12px;">' +
    '<div class="field" style="flex:1;"><label>Category</label><select id="lessonCategoryInput">' +
    LESSON_CATEGORIES.map(c => '<option value="' + c + '" ' + (lesson && lesson.category === c ? "selected" : "") + '>' + c + '</option>').join("") + '</select></div>' +
    '<div class="field" style="flex:1;"><label>Difficulty</label><select id="lessonDifficultyInput">' +
    LESSON_DIFFICULTIES.map(d => '<option value="' + d + '" ' + (lesson && lesson.difficulty === d ? "selected" : "") + '>' + d + '</option>').join("") + '</select></div>' +
    '</div>' +
    '<div class="field"><label>Attach to a level (optional — shows a level badge, doesn\'t block access)</label><select id="lessonLevelInput"><option value="">None</option>' +
    levelsForSelect.map(lv => '<option value="' + lv.id + '" ' + (lesson && lesson.levelId === lv.id ? "selected" : "") + '>' + escapeHtml(lv.title) + '</option>').join("") + '</select></div>' +
    '<div class="field"><label>Order (lower shows first)</label><input type="number" id="lessonOrderInput" value="' + (lesson ? lesson.order || 0 : 0) + '"></div>' +
    '<div class="field"><label>EXP reward</label><input type="number" id="lessonXpInput" min="1" max="200" value="' + (lesson && lesson.xpReward ? lesson.xpReward : 25) + '"></div>' +
    '<h4 style="margin:18px 0 8px;">Content blocks</h4>' +
    '<div class="add-block-row">' +
    Object.keys(BLOCK_TYPE_LABELS).map(t => '<button type="button" class="add-block-btn" data-add-block="' + t + '">+ ' + BLOCK_TYPE_LABELS[t] + '</button>').join("") +
    '</div>' +
    '<div class="block-editor-list" id="blockEditorList"></div>' +
    '<div class="field"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="lessonPublishedInput" ' + (lesson && lesson.published ? "checked" : "") + ' style="width:auto;"> Published (visible to students)</label></div>' +
    '<button class="btn btn-primary btn-block" id="saveLessonBtn">Save lesson</button>',
    () => {
      let blocks = lesson && lesson.blocks ? JSON.parse(JSON.stringify(lesson.blocks)) : [];
      let rteControllers = {};

      function syncRteToBlocks() {
        Object.keys(rteControllers).forEach(i => {
          const idx = parseInt(i, 10);
          if (blocks[idx] && rteControllers[idx]) blocks[idx].html = rteControllers[idx].getHtml();
        });
      }

      function renderBlockList() {
        const listHost = document.getElementById("blockEditorList");
        rteControllers = {};
        if (!blocks.length) {
          listHost.innerHTML = '<div class="empty-state"><h3>No blocks yet</h3><p>Use the buttons above to add heading, text, images, embeds, or a quiz.</p></div>';
          return;
        }
        listHost.innerHTML = blocks.map((b, i) => blockEditorItemHtml(b, i)).join("");

        blocks.forEach((b, i) => {
          const bodyHost = listHost.querySelector('[data-block-body="' + i + '"]');
          if (!bodyHost) return;
          if (b.type === "richtext" || b.type === "tip" || b.type === "warning") {
            rteControllers[i] = createRichTextEditor(bodyHost.querySelector(".rte-mount"), b.html);
          } else if (b.type === "heading") {
            bodyHost.querySelector(".block-heading-text").addEventListener("input", (e) => { blocks[i].text = e.target.value; });
            bodyHost.querySelector(".block-heading-level").addEventListener("change", (e) => { blocks[i].level = e.target.value; });
          } else if (b.type === "image") {
            bodyHost.querySelector(".block-image-url").addEventListener("input", (e) => { blocks[i].url = e.target.value; });
            bodyHost.querySelector(".block-image-caption").addEventListener("input", (e) => { blocks[i].caption = e.target.value; });
          } else if (b.type === "youtube" || b.type === "slides") {
            bodyHost.querySelector(".block-embed-url").addEventListener("input", (e) => { blocks[i].url = e.target.value; });
          } else if (b.type === "accordion") {
            wireAccordionBlockEditor(bodyHost, blocks[i]);
          } else if (b.type === "quiz") {
            wireQuizBlockEditor(bodyHost, blocks[i]);
          }
        });

        listHost.querySelectorAll("[data-move-up]").forEach(btn => btn.addEventListener("click", () => {
          syncRteToBlocks();
          const i = parseInt(btn.getAttribute("data-move-up"), 10);
          if (i > 0) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; renderBlockList(); }
        }));
        listHost.querySelectorAll("[data-move-down]").forEach(btn => btn.addEventListener("click", () => {
          syncRteToBlocks();
          const i = parseInt(btn.getAttribute("data-move-down"), 10);
          if (i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; renderBlockList(); }
        }));
        listHost.querySelectorAll("[data-remove-block]").forEach(btn => btn.addEventListener("click", () => {
          syncRteToBlocks();
          blocks.splice(parseInt(btn.getAttribute("data-remove-block"), 10), 1);
          renderBlockList();
        }));
      }

      document.querySelectorAll("[data-add-block]").forEach(btn => {
        btn.addEventListener("click", () => {
          syncRteToBlocks();
          blocks.push(defaultBlock(btn.getAttribute("data-add-block")));
          renderBlockList();
        });
      });

      renderBlockList();

      document.getElementById("saveLessonBtn").addEventListener("click", async () => {
        syncRteToBlocks();
        const alertHost = document.getElementById("lessonEditorAlert");
        const title = document.getElementById("lessonTitleInput").value.trim();
        if (!title) { renderAlert(alertHost, "Title is required."); return; }
        const data = {
          title,
          category: document.getElementById("lessonCategoryInput").value,
          difficulty: document.getElementById("lessonDifficultyInput").value,
          levelId: document.getElementById("lessonLevelInput").value || null,
          order: parseInt(document.getElementById("lessonOrderInput").value, 10) || 0,
          xpReward: Math.max(1, Math.min(200, parseInt(document.getElementById("lessonXpInput").value, 10) || 25)),
          published: document.getElementById("lessonPublishedInput").checked,
          blocks,
          estimatedMinutes: computeReadingMinutesAdmin(blocks),
        };
        const btn = document.getElementById("saveLessonBtn");
        setBtnLoading(btn, true);
        try {
          if (isNew) await db.collection("lessons").add(data);
          else await db.collection("lessons").doc(lesson.id).update(data);
          showToast("Lesson saved.", "success");
          closeAdminModal();
          loadLessonsPanel();
        } catch (err) {
          renderAlert(alertHost, describeFirebaseError(err));
        } finally {
          setBtnLoading(btn, false, "Save lesson");
        }
      });
    }
  );
}

function blockEditorItemHtml(b, i) {
  let bodyHtml = "";
  if (b.type === "heading") {
    bodyHtml = '<div class="field" style="margin-bottom:8px;"><input type="text" class="block-heading-text" placeholder="Heading text" value="' + escapeAttr(b.text) + '"></div>' +
      '<select class="block-heading-level"><option value="h2" ' + (b.level === "h2" ? "selected" : "") + '>Large (H2)</option><option value="h3" ' + (b.level === "h3" ? "selected" : "") + '>Small (H3)</option></select>';
  } else if (b.type === "richtext" || b.type === "tip" || b.type === "warning") {
    bodyHtml = '<div class="rte-mount"></div>';
  } else if (b.type === "divider") {
    bodyHtml = '<p style="color:var(--ink-soft); font-size:0.85rem; margin:0;">A horizontal divider — no content needed.</p>';
  } else if (b.type === "image") {
    bodyHtml = '<div class="field"><label>Image URL</label><input type="text" class="block-image-url" value="' + escapeAttr(b.url) + '" placeholder="https://…"></div>' +
      '<div class="field" style="margin-bottom:0;"><label>Caption (optional)</label><input type="text" class="block-image-caption" value="' + escapeAttr(b.caption) + '"></div>';
  } else if (b.type === "youtube") {
    bodyHtml = '<div class="field" style="margin-bottom:0;"><label>YouTube link</label><input type="text" class="block-embed-url" value="' + escapeAttr(b.url) + '" placeholder="https://youtube.com/watch?v=…"></div>';
  } else if (b.type === "slides") {
    bodyHtml = '<div class="field" style="margin-bottom:0;"><label>Google Slides or Canva embed link</label><input type="text" class="block-embed-url" value="' + escapeAttr(b.url) + '" placeholder="https://docs.google.com/presentation/d/…"></div>';
  } else if (b.type === "accordion") {
    bodyHtml = '<div class="accordion-editor-host"></div><button type="button" class="btn btn-ghost btn-sm add-accordion-item">+ Add section</button>';
  } else if (b.type === "quiz") {
    bodyHtml = '<div class="quiz-block-editor-host"></div><button type="button" class="btn btn-ghost btn-sm add-quiz-question">+ Add question</button>';
  }
  return '<div class="block-editor-item"><div class="block-editor-item-head">' +
    '<span class="block-type-label">' + BLOCK_TYPE_LABELS[b.type] + '</span>' +
    '<div class="block-editor-item-actions">' +
    '<button type="button" data-move-up="' + i + '" title="Move up">↑</button>' +
    '<button type="button" data-move-down="' + i + '" title="Move down">↓</button>' +
    '<button type="button" data-remove-block="' + i + '" title="Remove">✕</button>' +
    '</div></div><div class="block-editor-item-body" data-block-body="' + i + '">' + bodyHtml + '</div></div>';
}

function wireAccordionBlockEditor(bodyHost, block) {
  const host = bodyHost.querySelector(".accordion-editor-host");
  function render() {
    host.innerHTML = block.items.map((it, i) =>
      '<div class="repeat-row" style="flex-direction:column; align-items:stretch;">' +
      '<div style="display:flex; gap:8px;"><div class="field" style="flex:1; margin-bottom:6px;"><input type="text" data-ai="' + i + '" data-f="title" placeholder="Section title" value="' + escapeAttr(it.title) + '"></div>' +
      '<button type="button" class="remove-row-btn" data-remove-acc="' + i + '">✕</button></div>' +
      '<textarea data-ai="' + i + '" data-f="content" rows="3" placeholder="Section content (plain text)" style="width:100%; padding:10px 12px; border:1.5px solid var(--line-strong); border-radius:8px; font-family:inherit;">' + escapeHtml(it.content) + '</textarea>' +
      '</div>'
    ).join("");
    host.querySelectorAll("[data-f]").forEach(el => el.addEventListener("input", () => {
      const i = parseInt(el.getAttribute("data-ai"), 10);
      block.items[i][el.getAttribute("data-f")] = el.value;
    }));
    host.querySelectorAll("[data-remove-acc]").forEach(btn => btn.addEventListener("click", () => {
      block.items.splice(parseInt(btn.getAttribute("data-remove-acc"), 10), 1);
      render();
    }));
  }
  render();
  bodyHost.querySelector(".add-accordion-item").addEventListener("click", () => {
    block.items.push({ title: "", content: "" });
    render();
  });
}

function wireQuizBlockEditor(bodyHost, block) {
  const host = bodyHost.querySelector(".quiz-block-editor-host");
  function render() {
    host.innerHTML = block.questions.map((q, qi) =>
      '<div class="repeat-row" style="flex-direction:column; align-items:stretch;">' +
      '<div style="display:flex; gap:8px;"><div class="field" style="flex:1; margin-bottom:6px;"><input type="text" data-qqi="' + qi + '" data-f="text" placeholder="Question ' + (qi + 1) + '" value="' + escapeAttr(q.text) + '"></div>' +
      '<button type="button" class="remove-row-btn" data-remove-qq="' + qi + '">✕</button></div>' +
      [0, 1, 2, 3].map(oi =>
        '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
        '<input type="radio" class="correct-radio" name="lqcorrect' + qi + '" data-qqi="' + qi + '" data-oi="' + oi + '" ' + (q.correctIndex === oi ? "checked" : "") + '>' +
        '<input type="text" data-qqi="' + qi + '" data-oi="' + oi + '" data-f="opt" placeholder="Option ' + (oi + 1) + '" value="' + escapeAttr(q.options[oi] || "") + '" style="flex:1; padding:8px 10px; border:1.5px solid var(--line-strong); border-radius:8px;"></div>'
      ).join("") + '</div>'
    ).join("");
    host.querySelectorAll("input[data-f='text']").forEach(inp => inp.addEventListener("input", () => {
      block.questions[parseInt(inp.getAttribute("data-qqi"), 10)].text = inp.value;
    }));
    host.querySelectorAll("input[data-f='opt']").forEach(inp => inp.addEventListener("input", () => {
      const qi = parseInt(inp.getAttribute("data-qqi"), 10), oi = parseInt(inp.getAttribute("data-oi"), 10);
      block.questions[qi].options[oi] = inp.value;
    }));
    host.querySelectorAll(".correct-radio").forEach(r => r.addEventListener("change", () => {
      block.questions[parseInt(r.getAttribute("data-qqi"), 10)].correctIndex = parseInt(r.getAttribute("data-oi"), 10);
    }));
    host.querySelectorAll("[data-remove-qq]").forEach(btn => btn.addEventListener("click", () => {
      block.questions.splice(parseInt(btn.getAttribute("data-remove-qq"), 10), 1);
      render();
    }));
  }
  render();
  bodyHost.querySelector(".add-quiz-question").addEventListener("click", () => {
    block.questions.push({ text: "", options: ["", "", "", ""], correctIndex: 0 });
    render();
  });
}

/* ---------------------------------------------------------
   8. Placement quiz CRUD
   --------------------------------------------------------- */
let __placementQuestions = [];

async function loadPlacementPanel() {
  const host = document.getElementById("placementListHost");
  host.innerHTML = '<div class="loading-block"><span class="spinner"></span> Loading placement quiz…</div>';
  try {
    const doc = await db.collection("placementQuiz").doc("config").get();
    __placementQuestions = (doc.exists && doc.data().questions) || [];
    renderPlacementEditor();
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadPlacementPanel });
  }
}

function renderPlacementEditor() {
  const host = document.getElementById("placementListHost");
  if (!__placementQuestions.length) {
    host.innerHTML = '<div class="empty-state"><h3>No placement questions yet</h3><p>Add a question or load the starter set.</p></div>';
    return;
  }
  host.innerHTML = __placementQuestions.map((q, qi) =>
    '<div class="card">' +
    '<div class="card-row" style="margin-bottom:10px;">' +
    '<div class="field" style="flex:1; margin-bottom:0;"><label>Question ' + (qi + 1) + '</label><input type="text" data-pqi="' + qi + '" data-f="text" value="' + escapeAttr(q.text) + '"></div>' +
    '<button type="button" class="remove-row-btn" data-remove-q="' + qi + '">✕ Remove question</button></div>' +
    q.options.map((opt, oi) =>
      '<div class="tag-select-row" style="margin-bottom:8px;">' +
      '<input type="text" style="flex:1; padding:10px 12px; border:1.5px solid var(--line-strong); border-radius:8px;" data-pqi="' + qi + '" data-poi="' + oi + '" data-f="optText" value="' + escapeAttr(opt.text) + '" placeholder="Answer option">' +
      '<select data-pqi="' + qi + '" data-poi="' + oi + '" data-f="optScore" style="width:150px;">' +
      [0, 1, 2, 3].map(s => '<option value="' + s + '" ' + (opt.score === s ? "selected" : "") + '>Suggests Level ' + (s + 1) + '</option>').join("") +
      '</select></div>'
    ).join("") +
    '<button type="button" class="btn btn-ghost btn-sm" data-add-opt="' + qi + '">+ Add option</button>' +
    '</div>'
  ).join("");

  host.querySelectorAll("input[data-f='text']").forEach(inp =>
    inp.addEventListener("input", () => { __placementQuestions[parseInt(inp.getAttribute("data-pqi"), 10)].text = inp.value; })
  );
  host.querySelectorAll("[data-f='optText']").forEach(inp =>
    inp.addEventListener("input", () => {
      const qi = parseInt(inp.getAttribute("data-pqi"), 10), oi = parseInt(inp.getAttribute("data-poi"), 10);
      __placementQuestions[qi].options[oi].text = inp.value;
    })
  );
  host.querySelectorAll("[data-f='optScore']").forEach(sel =>
    sel.addEventListener("change", () => {
      const qi = parseInt(sel.getAttribute("data-pqi"), 10), oi = parseInt(sel.getAttribute("data-poi"), 10);
      __placementQuestions[qi].options[oi].score = parseInt(sel.value, 10);
    })
  );
  host.querySelectorAll("[data-remove-q]").forEach(btn =>
    btn.addEventListener("click", () => { __placementQuestions.splice(parseInt(btn.getAttribute("data-remove-q"), 10), 1); renderPlacementEditor(); })
  );
  host.querySelectorAll("[data-add-opt]").forEach(btn =>
    btn.addEventListener("click", () => {
      const qi = parseInt(btn.getAttribute("data-add-opt"), 10);
      __placementQuestions[qi].options.push({ text: "", score: 0 });
      renderPlacementEditor();
    })
  );
}

document.getElementById("addPlacementQBtn").addEventListener("click", () => {
  __placementQuestions.push({ text: "", options: [{ text: "", score: 0 }, { text: "", score: 1 }] });
  renderPlacementEditor();
});

document.getElementById("loadStarterQuestionsBtn").addEventListener("click", () => {
  if (__placementQuestions.length && !confirm("This will replace your current placement quiz questions. Continue?")) return;
  __placementQuestions = [
    {
      text: "How comfortable are you introducing yourself in English?",
      options: [
        { text: "I don't know any English words yet", score: 0 },
        { text: "I know a few simple words", score: 1 },
        { text: "I can say a few full sentences", score: 2 },
        { text: "I can introduce myself easily", score: 3 },
      ],
    },
    {
      text: "Can you read a short English sentence out loud?",
      options: [
        { text: "Not yet", score: 0 },
        { text: "With a lot of help", score: 1 },
        { text: "With a little help", score: 2 },
        { text: "Yes, easily", score: 3 },
      ],
    },
    {
      text: "How do you feel about writing a short English sentence?",
      options: [
        { text: "I can't write in English yet", score: 0 },
        { text: "I can copy words I see", score: 1 },
        { text: "I can write a simple sentence", score: 2 },
        { text: "I can write a few sentences on my own", score: 3 },
      ],
    },
    {
      text: "How much English do you use in daily life?",
      options: [
        { text: "None at all", score: 0 },
        { text: "A few words here and there", score: 1 },
        { text: "Short conversations sometimes", score: 2 },
        { text: "I use English regularly", score: 3 },
      ],
    },
  ];
  renderPlacementEditor();
  showToast("Starter questions loaded — remember to save.", "success");
});

document.getElementById("savePlacementBtn").addEventListener("click", async () => {
  const btn = document.getElementById("savePlacementBtn");
  const alertHost = document.getElementById("adminAlertHost");
  setBtnLoading(btn, true);
  try {
    await db.collection("placementQuiz").doc("config").set({ questions: __placementQuestions });
    showToast("Placement quiz saved.", "success");
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err));
  } finally {
    setBtnLoading(btn, false, "Save placement quiz");
  }
});

/* ---------------------------------------------------------
   9. Password masking feature-detect (admin passcode field)
   --------------------------------------------------------- */
(function setupPasswordMasking() {
  if (!window.CSS || !CSS.supports("-webkit-text-security", "disc")) {
    document.querySelectorAll("input.pw-mask").forEach(el => { el.type = "password"; });
  }
})();

/* ---------------------------------------------------------
   10. AI Curriculum Assistant (OpenRouter)

   A chat that can draft activities in the exact same 7 row-based
   formats the admin can already build by hand: quiz, word match,
   fill in the blank, memory flip, word scramble, speed round, and
   picture pop. flashcards, listening, and sentence builder use a
   different, more free-form payload shape each and aren't wired
   into this yet -- ask for one of the seven above.

   Nothing the AI drafts touches Firestore directly. Every draft is
   opened in the exact same editor modal used everywhere else in
   this admin panel, pre-filled, for the admin to review, edit, and
   press Save on themselves -- same human-in-the-loop guarantee as
   the rest of this app.
   --------------------------------------------------------- */
const AI_ACTIVITY_TYPES = ["quiz", "match", "fill", "memoryFlip", "wordScramble", "speedRound", "picturePop",
  "oddOneOut", "sentenceOrder", "listenType", "categorize"];

// Groq hosts several different open models, each with a different
// speed/quality/context tradeoff. Rather than hardcoding one, the admin
// picks from a dropdown -- the choice is remembered in this browser via
// localStorage so it doesn't reset every time the panel reopens.
const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (best quality, default)" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fastest)" },
  { id: "llama3-70b-8192", label: "Llama 3 70B" },
  { id: "gemma2-9b-it", label: "Gemma 2 9B" },
];
const GROQ_DEFAULT_MODEL = GROQ_MODELS[0].id;
function getSelectedGroqModel() {
  return localStorage.getItem("jessedu_groq_model") || GROQ_DEFAULT_MODEL;
}
function setSelectedGroqModel(id) {
  localStorage.setItem("jessedu_groq_model", id);
}

const AI_SYSTEM_PROMPT =
  "You are the curriculum-writing assistant inside JessEDU, the free English-learning site run by " +
  "the Javanese English Speaking Society (JESS), a youth-led nonprofit teaching English to students " +
  "in Indonesia, many of them complete beginners, some of them children in orphanages with limited or " +
  "no other access to English education.\n\n" +
  "Write like an encouraging peer tutor, not a textbook and not a corporate e-learning platform. Warm, " +
  "patient, plain language, short sentences. Never condescending. No jargon without explaining it in " +
  "the same breath. Favor concrete, everyday, locally relevant examples (food, family, school, the " +
  "market) over generic or Western-centric ones. Wrong quiz options should be plausible, not absurd. " +
  "Never use an em dash (—) anywhere in any text you write; use a period or comma instead.\n\n" +
  "You help staff draft learning activities. When asked to create one, reply with a short, friendly " +
  "sentence describing what you made, then a single fenced JSON code block with this exact shape:\n\n" +
  "{\"type\": one of " + JSON.stringify(AI_ACTIVITY_TYPES) + ", \"title\": \"a short activity title\", " +
  "\"payload\": <matches the type, see below>}\n\n" +
  "Payload shapes, one per type, follow EXACTLY:\n" +
  "quiz: {\"questions\":[{\"text\":\"...\",\"options\":[\"a\",\"b\",\"c\",\"d\"],\"correctIndex\":0}]} (always exactly 4 options)\n" +
  "match: {\"pairs\":[{\"term\":\"...\",\"definition\":\"...\"}]}\n" +
  "fill: {\"items\":[{\"sentence\":\"uses ___ for the blank\",\"answer\":\"...\"}]}\n" +
  "memoryFlip: {\"pairs\":[{\"a\":\"...\",\"b\":\"...\"}]} (a/b are the two matching cards, e.g. English word + Indonesian translation)\n" +
  "wordScramble: {\"words\":[{\"word\":\"lowercase, no spaces\",\"hint\":\"optional short hint\"}]}\n" +
  "speedRound: {\"statements\":[{\"text\":\"...\",\"isTrue\":true}],\"seconds\":30}\n" +
  "picturePop: {\"rounds\":[{\"word\":\"...\",\"correctEmoji\":\"single emoji\",\"decoyEmojis\":[\"emoji\",\"emoji\",\"emoji\"]}]}\n" +
  "oddOneOut: {\"rounds\":[{\"words\":[\"...\",\"...\",\"...\",\"...\"],\"oddIndex\":0}]} (3 to 5 words per round, oddIndex points at the one that doesn't belong)\n" +
  "sentenceOrder: {\"sentences\":[{\"words\":[\"I\",\"like\",\"apples\"],\"hint\":\"\"}]} (words in their CORRECT order; the app shuffles them for the learner)\n" +
  "listenType: {\"items\":[{\"text\":\"...\",\"lang\":\"en\"}]} (lang is \"en\" or \"id\")\n" +
  "categorize: {\"categoryA\":\"...\",\"categoryB\":\"...\",\"items\":[{\"word\":\"...\",\"category\":\"A\"}]}\n\n" +
  "Rules: keep language simple, beginner-friendly, and appropriate for children unless told otherwise. " +
  "Do not invent a type outside the list above. Only include the JSON block " +
  "when the person is actually asking you to create or revise an activity; for general questions or small " +
  "talk, just reply normally with no JSON block at all.";

let aiMessages = [];
let aiRequestCount = 0;

function aiChatLog(){ return document.getElementById("aiChatLog"); }

function renderAiMessage(role, text, draft) {
  const log = aiChatLog();
  const bubble = document.createElement("div");
  bubble.className = "ai-bubble ai-bubble-" + role;
  const p = document.createElement("p");
  p.textContent = text;
  bubble.appendChild(p);
  if (draft) {
    const card = document.createElement("div");
    card.className = "ai-draft-card";
    card.innerHTML =
      '<div><strong>' + escapeHtml(draft.title || "Untitled") + '</strong>' +
      '<span class="ai-draft-type">' + escapeHtml(ACTIVITY_TYPE_LABEL[draft.type] || draft.type) + '</span></div>' +
      '<button type="button" class="btn btn-outline btn-sm">Open in editor</button>';
    card.querySelector("button").addEventListener("click", () => {
      openActivityEditor(null, draft.type, { title: draft.title, payload: draft.payload });
    });
    bubble.appendChild(card);
  }
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
}

// Pulls the first ```json ... ``` block out of the reply and validates it
// against the known schemas above. Returns null (not an error) if the
// reply simply didn't include one, which is expected for plain chat.
function extractAiDraft(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  let parsed;
  try { parsed = JSON.parse(match[1]); } catch (e) { return null; }
  if (!parsed || AI_ACTIVITY_TYPES.indexOf(parsed.type) === -1 || !parsed.payload) return null;
  return { type: parsed.type, title: String(parsed.title || "").slice(0, 120), payload: parsed.payload };
}

function stripAiDraftFence(text) {
  return text.replace(/```json\s*[\s\S]*?```/i, "").trim();
}

async function callGroq(messages, model) {
  const key = window.GROQ_API_KEY;
  if (!key) throw new Error("No Groq API key is configured (firebase-config.js).");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || GROQ_DEFAULT_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1400
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Groq request failed (" + res.status + "). " + detail.slice(0, 300));
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("The AI returned an empty response.");
  return text;
}

let __aiInited = false;
function initAiAssistant() {
  if (__aiInited) return;
  __aiInited = true;
  aiMessages = [{ role: "system", content: AI_SYSTEM_PROMPT }];

  const modelSelect = document.getElementById("aiModelSelect");
  modelSelect.innerHTML = GROQ_MODELS.map((m) => '<option value="' + m.id + '">' + escapeHtml(m.label) + '</option>').join("");
  modelSelect.value = getSelectedGroqModel();
  modelSelect.addEventListener("change", () => setSelectedGroqModel(modelSelect.value));

  renderAiMessage("assistant",
    "Tell me what you would like to teach. For example: \"a beginner quiz about fruit, five questions\" or \"a word match for family members, English to Indonesian\".");

  document.getElementById("aiChatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("aiChatInput");
    const text = input.value.trim();
    if (!text) return;
    const sendBtn = document.getElementById("aiChatSendBtn");
    renderAiMessage("user", text);
    input.value = "";
    setBtnLoading(sendBtn, true);

    aiRequestCount++;
    aiMessages.push({ role: "user", content: text });

    // Every 10th request, re-inject a fresh copy of the system prompt
    // as its own message immediately before this one. Long chat
    // sessions can drift away from instructions given only once at
    // the very start; this periodically re-grounds the model in the
    // exact schema and rules without restarting the conversation.
    const outgoing = aiMessages.slice();
    if (aiRequestCount % 10 === 0) {
      outgoing.splice(outgoing.length - 1, 0, { role: "system", content: "Reminder of your instructions:\n\n" + AI_SYSTEM_PROMPT });
    }

    try {
      const reply = await callGroq(outgoing, getSelectedGroqModel());
      aiMessages.push({ role: "assistant", content: reply });
      const draft = extractAiDraft(reply);
      renderAiMessage("assistant", stripAiDraftFence(reply) || "Here is a draft:", draft);
    } catch (err) {
      console.warn("JessEDU: AI assistant request failed.", err);
      renderAiMessage("assistant", (err && err.message) || "Something went wrong reaching the AI. Please try again.");
    } finally {
      setBtnLoading(sendBtn, false, "Send");
    }
  });
}
