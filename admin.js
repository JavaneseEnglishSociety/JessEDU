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
   --------------------------------------------------------- */
function showAdminView(name) {
  document.getElementById("adminGate").hidden = name !== "gate";
  document.getElementById("adminDashboard").hidden = name !== "dashboard";
}

document.getElementById("adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alertHost = document.getElementById("adminGateAlert");
  renderAlert(alertHost, "");
  const passcode = document.getElementById("authSecret9").value;
  const btn = document.getElementById("adminLoginBtn");
  setBtnLoading(btn, true);
  try {
    await auth.signInWithEmailAndPassword(ADMIN_EMAIL, passcode);
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err));
  } finally {
    setBtnLoading(btn, false, "Enter admin panel");
  }
});

document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
  await auth.signOut();
});

auth.onAuthStateChanged((user) => {
  if (user && user.email === ADMIN_EMAIL) {
    showAdminView("dashboard");
    bootAdminDashboard();
  } else {
    showAdminView("gate");
  }
});

/* ---------------------------------------------------------
   2. Sidebar panel switching
   --------------------------------------------------------- */
const ADMIN_PANELS = ["overview", "learners", "levels", "activities", "placement", "media"];
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
   6c. Media Library (admin)
   --------------------------------------------------------- */
const MEDIA_CATEGORIES = ["Images", "Videos", "Audio", "Presentations", "Worksheets", "Icons", "Other"];

function mediaIconFor(mimeType) {
  if (!mimeType) return "📦";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎧";
  if (mimeType === "application/pdf") return "📄";
  return "📦";
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
  host.innerHTML = '<div class="media-grid">' + items.map(m =>
    '<div class="media-card" data-open-media="' + m.id + '">' +
    '<div class="media-thumb">' + (m.mimeType && m.mimeType.startsWith("image/") ? '<img src="' + escapeAttr(m.fileURL) + '" alt="">' : '<span>' + mediaIconFor(m.mimeType) + '</span>') + '</div>' +
    '<div class="media-info"><h4>' + escapeHtml(m.title) + '</h4><span class="media-cat-label">' + escapeHtml(m.category) + (m.published ? "" : " · draft") + '</span></div></div>'
  ).join("") + '</div>';
  host.querySelectorAll("[data-open-media]").forEach(card =>
    card.addEventListener("click", () => openAdminMediaEditor(items.find(m => m.id === card.getAttribute("data-open-media"))))
  );
}

document.getElementById("adminMediaSearchInput").addEventListener("input", renderAdminMediaGrid);

document.getElementById("mediaUploadBtn").addEventListener("click", async () => {
  const alertHost = document.getElementById("mediaUploadAlert");
  renderAlert(alertHost, "");
  const fileInput = document.getElementById("mediaFileInput");
  const file = fileInput.files[0];
  const title = document.getElementById("mediaTitleInput").value.trim();
  const category = document.getElementById("mediaCategoryInput").value;
  const tags = document.getElementById("mediaTagsInput").value.split(",").map(t => t.trim()).filter(Boolean);
  const published = document.getElementById("mediaPublishedInput").checked;
  if (!file) { renderAlert(alertHost, "Choose a file first."); return; }
  if (!title) { renderAlert(alertHost, "Title is required."); return; }

  const btn = document.getElementById("mediaUploadBtn");
  setBtnLoading(btn, true);
  try {
    const storagePath = "media/" + category + "/" + Date.now() + "_" + file.name;
    const ref = storage.ref(storagePath);
    await ref.put(file);
    const fileURL = await ref.getDownloadURL();
    await db.collection("media").add({
      title, category, tags, published,
      fileURL, fileName: file.name, mimeType: file.type || "", storagePath,
      createdAtMs: Date.now(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast("Media uploaded.", "success");
    fileInput.value = "";
    document.getElementById("mediaTitleInput").value = "";
    document.getElementById("mediaTagsInput").value = "";
    refreshAdminMediaGrid();
  } catch (err) {
    renderAlert(alertHost, describeFirebaseError(err));
  } finally {
    setBtnLoading(btn, false, "Upload");
  }
});

function openAdminMediaEditor(item) {
  openAdminModal(
    '<h3 style="margin-bottom:16px;">Edit media</h3><div id="mediaEditAlert"></div>' +
    '<div class="field"><label>Title</label><input type="text" id="mediaEditTitle" value="' + escapeAttr(item.title) + '"></div>' +
    '<div class="field"><label>Category</label><select id="mediaEditCategory">' +
    MEDIA_CATEGORIES.map(c => '<option value="' + c + '" ' + (item.category === c ? "selected" : "") + '>' + c + '</option>').join("") + '</select></div>' +
    '<div class="field"><label>Tags (comma separated)</label><input type="text" id="mediaEditTags" value="' + escapeAttr((item.tags || []).join(", ")) + '"></div>' +
    '<div class="field"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="mediaEditPublished" ' + (item.published ? "checked" : "") + ' style="width:auto;"> Published</label></div>' +
    '<div style="display:flex; gap:8px;"><button class="btn btn-primary" id="mediaEditSaveBtn">Save</button><button class="btn btn-danger" id="mediaEditDeleteBtn">Delete file</button></div>',
    () => {
      document.getElementById("mediaEditSaveBtn").addEventListener("click", async () => {
        const alertHost = document.getElementById("mediaEditAlert");
        try {
          await db.collection("media").doc(item.id).update({
            title: document.getElementById("mediaEditTitle").value.trim(),
            category: document.getElementById("mediaEditCategory").value,
            tags: document.getElementById("mediaEditTags").value.split(",").map(t => t.trim()).filter(Boolean),
            published: document.getElementById("mediaEditPublished").checked,
          });
          showToast("Media updated.", "success");
          closeAdminModal();
          refreshAdminMediaGrid();
        } catch (err) { renderAlert(alertHost, describeFirebaseError(err)); }
      });
      document.getElementById("mediaEditDeleteBtn").addEventListener("click", async () => {
        if (!confirm("Delete this file permanently?")) return;
        try {
          await storage.ref(item.storagePath).delete();
          await db.collection("media").doc(item.id).delete();
          showToast("Media deleted.", "success");
          closeAdminModal();
          refreshAdminMediaGrid();
        } catch (err) { showToast(describeFirebaseError(err), "error"); }
      });
    }
  );
}

/* ---------------------------------------------------------
   7. Activities CRUD (3 tailored editors)
   --------------------------------------------------------- */
let __adminLevelsCache = [];

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
    const typeLabel = { quiz: "Quiz", match: "Word match", fill: "Fill in the blank" };
    host.innerHTML = acts.map(a =>
      '<div class="card"><div class="card-row">' +
      '<div><h3 style="margin-bottom:2px;">' + escapeHtml(a.title) + ' <span class="badge ' + (a.published ? "badge-published" : "badge-draft") + '">' + (a.published ? "Published" : "Draft") + '</span></h3>' +
      '<p style="color:var(--ink-soft); margin:0;">' + (typeLabel[a.type] || a.type) + ' · Order ' + (a.order || 0) + '</p></div>' +
      '<div style="display:flex; gap:8px;">' +
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
  } catch (err) {
    host.innerHTML = "";
    renderAlert(document.getElementById("adminAlertHost"), describeFirebaseError(err), { onRetry: loadActivitiesList });
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

function openActivityEditor(activity, forceType) {
  const isNew = !activity;
  const type = activity ? activity.type : forceType;
  const levelId = document.getElementById("activityLevelSelect").value;

  const typeLabel = { quiz: "Quiz", match: "Word match", fill: "Fill in the blank" };
  let bodyHtml =
    '<h3 style="margin-bottom:16px;">' + (isNew ? "New " + typeLabel[type] : "Edit " + typeLabel[type]) + '</h3>' +
    '<div id="actEditorAlert"></div>' +
    '<div class="field"><label>Title</label><input type="text" id="actTitleInput" value="' + escapeAttr(activity ? activity.title : "") + '"></div>' +
    '<div class="field"><label>Order</label><input type="number" id="actOrderInput" value="' + (activity ? activity.order : 0) + '"></div>' +
    '<div id="actRowsHost"></div>' +
    '<button class="btn btn-secondary btn-sm" id="addRowBtn" type="button" style="margin-bottom:16px;">+ Add ' + (type === "quiz" ? "question" : type === "match" ? "pair" : "item") + '</button>' +
    '<div class="field"><label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="actPublishedInput" ' + (activity && activity.published ? "checked" : "") + ' style="width:auto;"> Published (visible to learners)</label></div>' +
    '<button class="btn btn-primary btn-block" id="saveActBtn">Save activity</button>';

  openAdminModal(bodyHtml, () => {
    const rowsHost = document.getElementById("actRowsHost");
    let rows = [];

    if (type === "quiz") {
      rows = activity && activity.payload && activity.payload.questions
        ? activity.payload.questions.map(q => ({ text: q.text, options: q.options.slice(), correctIndex: q.correctIndex }))
        : [{ text: "", options: ["", "", "", ""], correctIndex: 0 }];
    } else if (type === "match") {
      rows = activity && activity.payload && activity.payload.pairs
        ? activity.payload.pairs.map(p => ({ term: p.term, definition: p.definition }))
        : [{ term: "", definition: "" }];
    } else {
      rows = activity && activity.payload && activity.payload.items
        ? activity.payload.items.map(i => ({ sentence: i.sentence, answer: i.answer }))
        : [{ sentence: "", answer: "" }];
    }

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
          ).join("") +
          '</div>'
        ).join("");
      } else if (type === "match") {
        rowsHost.innerHTML = rows.map((p, i) =>
          '<div class="repeat-row">' +
          '<div class="field"><label>Term ' + (i + 1) + '</label><input type="text" data-qi="' + i + '" data-f="term" value="' + escapeAttr(p.term) + '"></div>' +
          '<div class="field"><label>Definition</label><input type="text" data-qi="' + i + '" data-f="definition" value="' + escapeAttr(p.definition) + '"></div>' +
          '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
        ).join("");
      } else {
        rowsHost.innerHTML = rows.map((it, i) =>
          '<div class="repeat-row">' +
          '<div class="field" style="flex:2;"><label>Sentence ' + (i + 1) + ' (use ___ for the blank)</label><input type="text" data-qi="' + i + '" data-f="sentence" value="' + escapeAttr(it.sentence) + '"></div>' +
          '<div class="field"><label>Answer</label><input type="text" data-qi="' + i + '" data-f="answer" value="' + escapeAttr(it.answer) + '"></div>' +
          '<button type="button" class="remove-row-btn" data-remove="' + i + '">✕</button></div>'
        ).join("");
      }

      rowsHost.querySelectorAll("input[type='text']").forEach(inp => {
        inp.addEventListener("input", () => {
          const qi = parseInt(inp.getAttribute("data-qi"), 10);
          const f = inp.getAttribute("data-f");
          if (f === "opt") {
            const oi = parseInt(inp.getAttribute("data-oi"), 10);
            rows[qi].options[oi] = inp.value;
          } else {
            rows[qi][f] = inp.value;
          }
        });
      });
      rowsHost.querySelectorAll(".correct-radio").forEach(r => {
        r.addEventListener("change", () => {
          const qi = parseInt(r.getAttribute("data-qi"), 10);
          rows[qi].correctIndex = parseInt(r.getAttribute("data-oi"), 10);
        });
      });
      rowsHost.querySelectorAll("[data-remove]").forEach(btn => {
        btn.addEventListener("click", () => {
          rows.splice(parseInt(btn.getAttribute("data-remove"), 10), 1);
          renderRows();
        });
      });
    }
    renderRows();

    document.getElementById("addRowBtn").addEventListener("click", () => {
      if (type === "quiz") rows.push({ text: "", options: ["", "", "", ""], correctIndex: 0 });
      else if (type === "match") rows.push({ term: "", definition: "" });
      else rows.push({ sentence: "", answer: "" });
      renderRows();
    });

    document.getElementById("saveActBtn").addEventListener("click", async () => {
      const alertHost = document.getElementById("actEditorAlert");
      const title = document.getElementById("actTitleInput").value.trim();
      if (!title) { renderAlert(alertHost, "Title is required."); return; }
      if (!rows.length) { renderAlert(alertHost, "Add at least one item."); return; }

      let payload;
      if (type === "quiz") payload = { questions: rows.map(q => ({ text: q.text, options: q.options, correctIndex: q.correctIndex })) };
      else if (type === "match") payload = { pairs: rows.map(p => ({ term: p.term, definition: p.definition })) };
      else payload = { items: rows.map(it => ({ sentence: it.sentence, answer: it.answer })) };

      const data = {
        type,
        levelId,
        title,
        order: parseInt(document.getElementById("actOrderInput").value, 10) || 0,
        published: document.getElementById("actPublishedInput").checked,
        payload,
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
