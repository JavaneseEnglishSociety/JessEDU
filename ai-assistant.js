/* ==========================================================================
   JessEDU — AI Lesson Assistant (Google Gemini)

   Generates ready-to-edit lesson blocks from a plain-language prompt, so a
   volunteer can go from "teach past tense to beginners" to a structured
   draft lesson in one step, then edit it like any hand-built lesson.

   IMPORTANT — about the API key below:
   This is a static site, so anything in this file is readable by anyone who
   opens view-source on the deployed page. The key is placed here directly
   at the site owner's explicit instruction for a closed testing
   environment on a free tier. If JessEDU is ever opened to the public,
   this key should be revoked at https://aistudio.google.com/apikey and the
   call moved behind a small server or Cloud Function that keeps the key
   secret. Treat the value below as public, not private.
   ========================================================================== */

const GEMINI_API_KEY = "AQ.Ab8RN6JrKTIDArD3xLsmw5gjDHmwS0RTzN2-7GmZXkBipvx0PA";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY;

/* The block schema Gemini must produce. This mirrors defaultBlock() in
   admin.js exactly — if a block type or field is added there, add it here
   too or the model will keep generating the older shape. */
const AI_BLOCK_SCHEMA = `
Each block must be one of these exact shapes:
{"type":"heading","text":"...","level":"h2"}
{"type":"richtext","html":"<p>...</p>"}
{"type":"divider"}
{"type":"tip","html":"<p>...</p>"}
{"type":"warning","html":"<p>...</p>"}
{"type":"accordion","items":[{"title":"...","content":"..."}]}
{"type":"quiz","questions":[{"text":"...","options":["a","b","c","d"],"correctIndex":0}]}

Rules:
- "html" fields may only use <p>, <strong>, <em>, <ul>, <ol>, <li>, <br>.
- Quiz questions always have exactly 4 options and a correctIndex of 0-3.
- Do not invent block types or fields beyond the shapes above.
- Do not include "image", "youtube", or "slides" blocks: those need real
  URLs that only a human can supply.
`;

function buildLessonPrompt(topic, level, blockCount) {
  return `You are helping write a free English lesson for JESS (Javanese English
Speaking Society), a youth-led nonprofit teaching English to students in
Indonesia, many of whom are complete beginners.

Write a lesson on: "${topic}"
Target learner level: ${level}
Produce about ${blockCount} blocks.

Guidance:
- Write for Indonesian learners; keep sentences short and plain.
- Start with a heading, then explain, then practise.
- Include at least one quiz block so the learner can check themselves.
- Prefer concrete everyday examples over grammar jargon.
- Never use em dashes anywhere in the output.

${AI_BLOCK_SCHEMA}

Respond with ONLY a JSON array of block objects. No markdown fences, no
commentary, no explanation before or after. The very first character of
your response must be [ and the last must be ].`;
}

async function callGemini(prompt) {
  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Gemini request failed (" + res.status + "). " + detail.slice(0, 300));
  }
  const data = await res.json();
  const text = data && data.candidates && data.candidates[0] &&
               data.candidates[0].content && data.candidates[0].content.parts &&
               data.candidates[0].content.parts[0] &&
               data.candidates[0].content.parts[0].text;
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

/* Models sometimes wrap JSON in ```json fences or add a stray sentence
   despite being told not to, so pull out the array rather than trusting
   the response to be clean. */
function extractJsonArray(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not find a JSON array in the AI response.");
  }
  return JSON.parse(t.slice(start, end + 1));
}

/* Never trust model output straight into the editor: drop anything that
   isn't a known block type and repair partial blocks, so a malformed
   response degrades into fewer good blocks instead of corrupting the
   lesson or throwing inside the render loop. */
const AI_ALLOWED_TYPES = ["heading", "richtext", "divider", "tip", "warning", "accordion", "quiz"];

function sanitizeAiBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((b) => {
    if (!b || typeof b !== "object" || AI_ALLOWED_TYPES.indexOf(b.type) === -1) return;
    switch (b.type) {
      case "heading":
        out.push({ type: "heading", text: String(b.text || "").slice(0, 200),
                   level: ["h2", "h3"].indexOf(b.level) !== -1 ? b.level : "h2" });
        break;
      case "richtext":
      case "tip":
      case "warning":
        out.push({ type: b.type, html: String(b.html || "<p></p>").slice(0, 6000) });
        break;
      case "divider":
        out.push({ type: "divider" });
        break;
      case "accordion": {
        const items = Array.isArray(b.items) ? b.items : [];
        const clean = items
          .filter((i) => i && (i.title || i.content))
          .map((i) => ({ title: String(i.title || "").slice(0, 200),
                         content: String(i.content || "").slice(0, 2000) }));
        if (clean.length) out.push({ type: "accordion", items: clean });
        break;
      }
      case "quiz": {
        const qs = Array.isArray(b.questions) ? b.questions : [];
        const clean = qs.filter((q) => q && q.text && Array.isArray(q.options) && q.options.length >= 2)
          .map((q) => {
            const options = q.options.slice(0, 4).map((o) => String(o).slice(0, 300));
            while (options.length < 4) options.push("");
            let ci = Number(q.correctIndex);
            if (!Number.isInteger(ci) || ci < 0 || ci > 3) ci = 0;
            return { text: String(q.text).slice(0, 500), options, correctIndex: ci };
          });
        if (clean.length) out.push({ type: "quiz", questions: clean });
        break;
      }
    }
  });
  return out;
}

/* Public entry point used by admin.js. Resolves to an array of blocks in
   exactly the shape the lesson editor already understands. */
async function generateLessonBlocks(topic, level, blockCount) {
  const text = await callGemini(buildLessonPrompt(topic, level, blockCount));
  const blocks = sanitizeAiBlocks(extractJsonArray(text));
  if (!blocks.length) throw new Error("The AI response did not contain any usable lesson blocks. Try rephrasing the topic.");
  return blocks;
}

/* Rewrites or improves one piece of text in place (used by the small
   "Improve with AI" affordance on rich text blocks). */
async function improveText(html, instruction) {
  const prompt = `Rewrite the following lesson HTML for Indonesian students learning English.
${instruction}
Keep it as simple HTML using only <p>, <strong>, <em>, <ul>, <ol>, <li>, <br>.
Never use em dashes. Respond with ONLY the rewritten HTML, no commentary.

${html}`;
  const text = await callGemini(prompt);
  return String(text).replace(/^```(?:html)?/i, "").replace(/```$/, "").trim();
}

window.JessAI = { generateLessonBlocks, improveText, isConfigured: () => !!GEMINI_API_KEY };
