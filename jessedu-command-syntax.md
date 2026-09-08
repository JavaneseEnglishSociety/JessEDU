# JessEDU Lesson Command Syntax

Give this whole file to an AI (ChatGPT, Claude, etc.) along with what you want the lesson to teach, and paste what it writes back into the admin panel's **Command Panel** tab.

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

Write the whole lesson now using only this format, nothing else around it.
```

## Full worked example
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
