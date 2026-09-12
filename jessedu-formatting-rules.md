# JessEDU Formatting Rules

Four kinds of content can be created this way: lessons, levels, activities, and — new — a bulk document combining any mix of the three in one paste. This document covers all four; give the whole thing to an AI along with the content guidelines, plus a note on what to write.

Note the difference between a **standalone lesson** (Part 1, lives in the free-browse Library) and a **lesson-type activity** (part of Part 3, lives inside a level's path). They use the identical `[TAG]` block syntax; only where they end up differs.

The formatting rules below include an explicit "mistakes that break parsing" section in both Part 1 and Part 3 with wrong/right examples, pulled directly from real formatting errors that happened. Several of the mistakes described are now automatically recovered by the parser (header fields crammed onto one line, an entire quiz question jammed onto one line, an accordion line missing its leading "-"), with a warning shown so the mistake is still visible even though it worked. A few genuinely cannot be recovered (like using "*" and "=" in an accordion instead of "-" and ":") since there's no safe way to guess what was meant.

---

# Part 1: Lessons (standalone, in the Library)

```
Write a JessEDU lesson using this exact plain-text format. Follow it precisely -- every tag is a square-bracketed word in capitals, like [HEADING] or [QUIZ].

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
  One "- Title: Content" per line. As many lines as you want. The leading
  "-" should always be there, but a line will still work without it as
  long as it's "Title: Content" with exactly one colon.

[QUIZ]
Q: The question text
A: A wrong answer
A: The correct answer *
A: Another wrong answer
A: Another wrong answer
  Start each question with "Q:". Follow it with exactly four "A:" lines,
  one per option. Put a single * right after the correct one. You can
  repeat Q:/A:/A:/A:/A: as many times as you want for more questions.

Mistakes that break parsing, avoid all of these:

WRONG (header fields on one line):
TITLE: Colors CATEGORY: Vocabulary DIFFICULTY: Beginner
RIGHT (each field on its own line):
TITLE: Colors
CATEGORY: Vocabulary
DIFFICULTY: Beginner

WRONG (using * as a bullet point inside [TEXT]/[TIP]/[WARNING] -- this is
never valid, since * is reserved for **bold** and *italic*, and a list
written this way will not render as a list at all):
[TEXT]
* Sofa = a long chair
* Table = for eating
RIGHT (write it as normal sentences, or use [ACCORDION] instead if it is
genuinely a list of terms and their meanings):
[TEXT]
A sofa is a long chair for sitting comfortably. A table is what you eat
or work at.

WRONG (accordion using * and = instead of - and :):
[ACCORDION]
* Sofa = a long chair
RIGHT (accordion must use a dash and a colon, exactly):
[ACCORDION]
- Sofa: a long chair

WRONG (an entire question and its answers squeezed onto one line):
[QUIZ] Q: Which is red? A: Apple * A: Banana A: Grape A: Lemon
RIGHT (every Q: and every A: is its own separate line):
[QUIZ]
Q: Which is red?
A: Apple *
A: Banana
A: Grape
A: Lemon

Write the whole lesson now using only this format, nothing else around it.
```

## A complete, correctly formatted example

```
TITLE: Colors
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
A: Banana
```

---

# Part 2: Levels

Levels are the chapters in a learner's path. A level has no content blocks of its own, just a title, description, and order.

```
Write a JessEDU level (a chapter in the learning path) using this format. Just a few header lines, no blocks or tags needed.

TITLE: the level's title
DESCRIPTION: a short description of what this level covers
ORDER: a number — lower numbers appear first in the path

Write it now using only this format, nothing else around it.
```

## A complete example

```
TITLE: Everyday Words
DESCRIPTION: Learn the words you'll use every single day, at home, at school, and with friends.
ORDER: 2
```

---

# Part 3: Activities

Activities are the 16 different things that can appear inside a level's path: 15 interactive game types plus the "lesson" type (real reading content, using the exact same block tags as Part 1, but attached to a level instead of living in the free-browse Library).

```
Write a JessEDU activity using this format. Start with header lines, then a body whose format depends on TYPE.

Header (TITLE and TYPE required, the rest optional):
TITLE: the activity's title
TYPE: one of lesson, quiz, match, fill, memoryFlip, wordScramble, speedRound, picturePop, oddOneOut, sentenceOrder, listenType, categorize
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

Write the whole activity now using only this format, nothing else around it.

For TYPE: lesson specifically, the body uses [HEADING]/[TEXT]/[TIP]/[WARNING]/
[DIVIDER]/[ACCORDION]/[QUIZ] tags -- the same mistakes that break a standalone
lesson break this too. Avoid all of these:

WRONG (header fields on one line): TITLE: X TYPE: lesson LEVEL: Y
RIGHT (each field on its own line):
TITLE: X
TYPE: lesson
LEVEL: Y

WRONG (using * as a bullet point inside [TEXT]/[TIP]/[WARNING] -- * is
reserved for **bold** and *italic*, a list written this way won't render
as a list at all):
[TEXT]
* Sofa = a long chair
RIGHT (write normal sentences, or use [ACCORDION] for a term/meaning list):
[ACCORDION]
- Sofa: a long chair

WRONG (an entire question and its answers on one line):
[QUIZ] Q: Which is red? A: Apple * A: Banana A: Grape A: Lemon
RIGHT (every Q: and every A: is its own line):
[QUIZ]
Q: Which is red?
A: Apple *
A: Banana
A: Grape
A: Lemon
```

## A complete "lesson" activity example

```
TITLE: Greetings
TYPE: lesson
LEVEL: Everyday Words
XP: 25

[HEADING] Saying Hello
[TEXT]
In English, "hello" and "hi" are the two most common greetings. "Hi" is a little more casual than "hello".

[TIP]
Try greeting someone new every day, even just in your head, to build the habit.

[QUIZ]
Q: Which greeting is more casual?
A: Hello
A: Hi *
A: Good morning
A: Good evening
```

---

# Part 4: Bulk — many items in one paste

Use the **Bulk** tab in the Command Panel to create many levels, lessons, and activities in a single paste instead of doing each one separately. Every item still becomes its own separate document in Firestore — this only saves the copy-pasting between tabs. There's also a checkbox to **auto-publish everything created**, skipping the usual draft-review step, for when you already trust the content and want to save time.

```
Write MULTIPLE JessEDU items (levels, lessons, and/or activities) in one document. Wrap each item in its own marker line, then use the EXACT SAME format that item type already uses on its own:

===LEVEL===
(the same format as a single level -- TITLE:, DESCRIPTION:, ORDER:)

===LESSON===
(the same format as a single standalone lesson -- TITLE:, CATEGORY:, DIFFICULTY:, MINUTES:, EXP:, then [HEADING]/[TEXT]/etc blocks)

===ACTIVITY===
(the same format as a single activity -- TITLE:, TYPE:, LEVEL:, XP:, then the body for that TYPE)

Rules:
- Each marker line is exactly "===LEVEL===", "===LESSON===", or "===ACTIVITY===" on its own line, nothing else on that line.
- Put as many items as needed, in any order, each with its own marker.
- If an ACTIVITY's LEVEL: names a level that ALSO appears earlier in this same document under ===LEVEL===, it will correctly attach to that newly created level, not just an existing one -- so levels should generally come before the activities that belong to them, though the exact order among different items doesn't otherwise matter.
- Do not nest markers or put content before the first marker.

Write the whole document now using only this format, nothing else around it.
```

## A complete example (one level, two activities, one standalone lesson)

```
===LEVEL===
TITLE: Everyday Words
DESCRIPTION: Learn the words you'll use every single day.
ORDER: 2

===ACTIVITY===
TITLE: Fruit Quiz
TYPE: quiz
LEVEL: Everyday Words
XP: 20

Q: Which one is red?
A: Apple *
A: Banana
A: Grape
A: Lemon

===ACTIVITY===
TITLE: Greetings
TYPE: lesson
LEVEL: Everyday Words
XP: 25

[HEADING] Saying Hello
[TEXT]
In English, "hello" and "hi" are the two most common greetings.

[QUIZ]
Q: Which greeting is more casual?
A: Hello
A: Hi *
A: Good morning
A: Good evening

===LESSON===
TITLE: Colors
CATEGORY: Vocabulary
DIFFICULTY: Beginner
MINUTES: 5
EXP: 20

[HEADING] Basic Colors
[TEXT]
Red, blue, and green are common colors.

[QUIZ]
Q: Which of these is red?
A: Banana
A: Apple *
A: Sky
A: Grass
```

### How level references resolve across a bulk paste

If an `===ACTIVITY===` item's `LEVEL:` names a level that also appears earlier in the *same* paste under `===LEVEL===`, it will correctly attach to that newly created level — not just a level that already existed in Firestore before this paste. Levels in a bulk paste are always created first, before any lesson or activity, specifically so this works. Put levels before the activities that belong to them when in doubt, though the order of everything else doesn't matter.
