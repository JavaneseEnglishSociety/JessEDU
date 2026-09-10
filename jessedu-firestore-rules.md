# Firestore Rules — JessEDU (shared project with JESS Portal)

Paste this into **Firebase Console → Firestore Database → Rules**, replacing everything currently there, then click **Publish**.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null && request.auth.token.email == "begawanbillykurniawan@gmail.com";
    }

    // ============================================================
    // JESSPORTAL (NGO info site) — shares this Firestore database
    // with JESSEDU below. JESSEDU's own code never touches these.
    // ============================================================
    // NOTE: JessPortal's admin panel no longer signs in with real Firebase
    // Authentication — the password is checked client-side only, against a
    // value stored directly in this repo (firebase-config.js). Firestore
    // rules run on Google's servers and cannot see that value, so the
    // isAdmin() checks below (originally requiring a signed-in Firebase
    // account matching the admin email) have been replaced with `if true`
    // for JessPortal's own collections. This was a deliberate choice for a
    // temporary/testing deployment with no real user data — it means these
    // collections have NO server-side write protection: anyone who can
    // reach this Firestore project (which just means having the public
    // apiKey, visible in any deployed page) can read, write, or delete
    // this data directly, with or without the admin panel's password
    // screen. JESSEDU's collections further below are untouched and still
    // require real authentication, since those hold actual student
    // accounts and progress data.
    match /jess/site {
      allow read: if true;
      allow write: if true;
    }
    match /messages/{messageId} {
      allow create: if true;
      allow read, delete: if true;
      allow update: if false;
    }

    // Event registrations / volunteer sign-ups from the public site.
    // Same shape as /messages: anyone may CREATE one (that is the point of
    // a public sign-up form). Read/delete are open for the same reason as
    // /jess/site above — see the note at the top of this section.
    match /registrations/{registrationId} {
      allow create: if request.resource.data.keys().hasOnly(
                         ['eventId', 'eventTitle', 'name', 'email', 'phone',
                          'role', 'why', 'createdAt'])
                    && request.resource.data.name is string
                    && request.resource.data.name.size() > 0
                    && request.resource.data.name.size() <= 120
                    && request.resource.data.email is string
                    && request.resource.data.email.size() <= 160
                    && request.resource.data.why.size() <= 1200
                    && request.resource.data.role in ['participant', 'volunteer'];
      allow read, delete: if true;
      allow update: if false;
    }

    // Volunteer applications — joining JESS itself, distinct from signing
    // up for one event (see /registrations above).
    //
    // GET (fetching one document by its exact ID) is open to anyone,
    // because the ID itself — a random Firestore auto-ID handed to the
    // applicant as their confirmation code — is the only thing that
    // grants access, independent of the admin-password question. LIST,
    // UPDATE, and DELETE are opened up here for the same reason as
    // /jess/site above (see the note at the top of this section).
    match /applications/{applicationId} {
      allow create: if request.resource.data.keys().hasOnly(
                         ['name', 'email', 'phone', 'school', 'role', 'department',
                          'availability', 'why', 'status', 'note', 'createdAt', 'reviewedAt'])
                    && request.resource.data.name is string
                    && request.resource.data.name.size() > 0
                    && request.resource.data.name.size() <= 120
                    && request.resource.data.email is string
                    && request.resource.data.email.size() <= 160
                    && request.resource.data.why.size() <= 1200
                    && request.resource.data.role in ['student', 'volunteer']
                    // A student has no department; a volunteer must pick
                    // one of the four real ones. Empty string covers the
                    // student case without needing a separate branch.
                    && request.resource.data.department in
                         ['', 'Academics', 'Media and Marketing', 'Public Relations', 'Internal Management']
                    && request.resource.data.status == "pending"
                    && request.resource.data.note == "";
      allow get: if true;
      allow list: if true;
      allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'note', 'reviewedAt'])
                    && request.resource.data.status in ['pending', 'accepted', 'declined'];
      allow delete: if true;
    }

    // ============================================================
    // JESSEDU — accounts
    // ============================================================

    // Username -> uid index. Publicly readable (needed to check
    // availability before signup) but a doc can only ever be CREATED —
    // never updated or deleted — by the uid that owns it. This makes
    // username claiming race-safe: if two people submit the same
    // username at once, Firestore's transaction retry logic guarantees
    // only one create wins.
    match /usernames/{username} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.auth.uid == request.resource.data.uid
                    && request.resource.data.keys().hasOnly(['uid', 'createdAt']);
      allow update, delete: if false;
    }

    // A learner's profile. Created once with fixed starting values.
    //
    // Updates: xp and jessPoints may only INCREASE or stay the same
    // (never decrease), each capped at a generous per-completion
    // ceiling (200 XP / 100 points) — this allows custom per-activity
    // EXP rewards while stopping a learner from granting themselves an
    // arbitrary XP total from the browser console. Using >= (not
    // strict >) is deliberate: it lets the client update streak /
    // lastActiveDate alone (e.g. a daily login check-in) WITHOUT being
    // forced to also bump xp/jessPoints on that same write — that
    // forced-increase requirement was the earlier bug that silently
    // rejected any write which didn't touch every field.
    //
    // This is a looser bound than a Cloud Function could give (which
    // could verify the exact reward against the specific activity's
    // configured xpReward), but rules can't cross-reference "which
    // activity triggered this write" from inside the users/{uid} path
    // — documented trade-off, same philosophy as level/streak below.
    match /users/{uid} {
      // isAdmin() requires a REAL signed-in Firebase session matching a
      // specific email. This admin panel never does that — it checks a
      // password locally in the browser and nothing else, the same as
      // JessPortal's admin. That means isAdmin() can NEVER be true here,
      // so any admin action gated behind it (like the Learners panel
      // reading a student's profile) was permanently rejected no matter
      // what password was entered. Reads are opened up the same way
      // every other admin-managed collection in this file already was.
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == uid
                    && request.resource.data.keys().hasOnly(
                         ['username', 'displayName', 'xp', 'level', 'jessPoints', 'streak', 'lastActiveDate', 'createdAt'])
                    && request.resource.data.xp == 0
                    && request.resource.data.level == 1
                    && request.resource.data.jessPoints == 0
                    && request.resource.data.streak == 0;
      allow update: if request.auth != null && request.auth.uid == uid
                    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
                         ['xp', 'level', 'jessPoints', 'streak', 'lastActiveDate', 'contactEmail', 'contactWhatsapp'])
                    && request.resource.data.xp >= resource.data.get('xp', 0)
                    && request.resource.data.xp <= resource.data.get('xp', 0) + 200
                    // jessPoints can move either way: up when earning XP,
                    // down when spending in the benefits shop. Never
                    // negative, and bounded either direction per write.
                    && request.resource.data.jessPoints >= 0
                    && (request.resource.data.jessPoints - resource.data.get('jessPoints', 0)) <= 100
                    && (resource.data.get('jessPoints', 0) - request.resource.data.jessPoints) <= 500
                    && request.resource.data.level is int && request.resource.data.level >= resource.data.level
                    && request.resource.data.streak is int && request.resource.data.streak >= 0;
      allow delete: if false;
    }

    // One completion record per learner per activity. create-only and
    // immutable — this is what stops a learner from replaying the same
    // activity for repeated XP: app.js checks this doc doesn't already
    // exist (in the same transaction as the users/{uid} update above)
    // before granting XP for it. xpEarned/pointsEarned are stored here
    // too so the student's XP History can show what each completion
    // actually paid out.
    match /users/{uid}/progress/{activityId} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid
                    && request.resource.data.keys().hasOnly(['completedAt', 'score', 'xpEarned', 'pointsEarned']);
      allow update, delete: if false;
    }

    // ============================================================
    // JESSEDU — content authored by the admin
    // ============================================================
    // NOTE: JessEDU's admin panel no longer signs in with real Firebase
    // Authentication either (matching JessPortal's admin — see admin.js).
    // The isAdmin() checks below are replaced with `if true` for these
    // CONTENT collections only. This means anyone who can reach this
    // Firestore project can read, write, or delete levels, activities,
    // lessons, media, and the placement quiz directly, with or without
    // ever opening the admin panel's password screen. Deliberate choice
    // for a closed testing deployment. Student accounts and progress
    // (users/{uid} and its progress subcollection, above) are completely
    // unaffected by this and still require a real signed-in student —
    // that part of the app never used the admin password at all.
    match /levels/{levelId} {
      allow read: if true;
      allow write: if true;
    }
    match /activities/{activityId} {
      allow read: if true;
      allow write: if true;
    }
    match /placementQuiz/config {
      allow read: if true;
      allow write: if true;
    }

    // Benefits shop: items are admin-managed content, same open pattern
    // as levels/activities above. Redemptions are created by a real
    // signed-in learner spending their own points -- the actual point
    // deduction happens against their own /users/{uid} profile above,
    // which is properly protected; this collection is just a durable
    // record of "who redeemed what" for staff to see and fulfil.
    match /shopItems/{itemId} {
      allow read: if true;
      allow write: if true;
    }
    match /redemptions/{redemptionId} {
      allow read: if true;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if true;
    }

    // ============================================================
    // JESSEDU — media library (images, videos, audio, PDFs/decks,
    // worksheets, icons). Files live in Storage; this doc is just
    // searchable metadata + the download URL.
    // ============================================================
    match /media/{mediaId} {
      allow read: if true;
      allow write: if true;
    }

    // ============================================================
    // JESSEDU — lessons (block-based teaching content: headings,
    // rich text, images, YouTube/Slides embeds, inline quizzes, tip/
    // warning boxes, accordions). Blocks live as an array field on
    // the lesson doc itself, same pattern as quiz questions/match
    // pairs on activities — keeps saves atomic, no extra collection
    // needed. Completion reuses the SAME users/{uid}/progress/{id}
    // rule already defined above (it doesn't care whether {id} is an
    // activityId or a lessonId, both are just unique document IDs).
    // ============================================================
    match /lessons/{lessonId} {
      allow read: if true;
      allow write: if true;
    }

    // ============================================================
    // SHARED — visitor analytics for BOTH sites. Both docs are now
    // open to read, since neither admin panel uses real Firebase Auth
    // any more.
    // ============================================================
    match /analytics/{docId} {
      allow read: if true;
      allow create: if docId in ['portalTotals', 'eduTotals']
                    && request.resource.data.keys().hasOnly(['visits', 'lastVisitAt'])
                    && request.resource.data.visits == 1;
      allow update: if docId in ['portalTotals', 'eduTotals']
                    && request.resource.data.keys().hasOnly(['visits', 'lastVisitAt'])
                    && request.resource.data.visits == resource.data.visits + 1;
      allow delete: if false;
    }
    match /presence/{sessionId} {
      allow create, update: if request.resource.data.keys().hasOnly(['lastSeen', 'loggedIn', 'page', 'site'])
                            && request.resource.data.site in ['portal', 'edu'];
      allow read: if true;
      allow delete: if true;
    }

  }
}
```
