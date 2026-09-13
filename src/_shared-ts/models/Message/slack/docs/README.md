---
created: 2026-09-12
updated: 2026-09-13
---

# Saved Slack conversations

`parseSlackConversation` owns message boundaries in Sky's saved Slack bodies.
Participant detection, Outbox timestamp indexing, and follow consolidation use
it. Other message media keep their existing readers. Slack API fetching, file
storage, and transcription are outside this parser.

Legacy messages are timestamp-and-author H2s. The new layout puts the same
headings at H3 inside `## Conversation`; H3s inside `## Attachments` describe
files. Mixed documents are readable. The parser recognizes Markdown blocks,
so a heading inside a quotation, list, code fence, or HTML block is not a
message. Consumers should use this reader instead of adding heading regexes.

The original Markdown remains authoritative. Sections carry UTF-16 source
offsets, including optional standalone `<a id="…"></a>` anchors before their
headings. Offsets refer to the body passed in, excluding YAML, and preserve
original line endings. A message's body includes an inline voice transcript
when present. Attachment entries retain their original heading and body;
the parser never generates a summary or infers a missing file association.
Attachment fragment links are read lazily, including Markdown reference links.

Block lexing deliberately avoids a full inline parse during notebook scans.
Reference definitions remain tokens so their bytes count toward source ranges.
Indented code is also retained as its own block: marked's paragraph/code merge
can insert a newline into `raw`, which would invalidate offsets into the original.
The source-coverage checks must continue to fail visibly if a lexer change
would make those ranges unsafe for edits.

Consolidation preserves non-message content and attachment entries. Provider
IDs, when present, distinguish messages. Legacy deduplication includes the body
as well as author and minute, because multiple replies can share that minute.
Conflicting bodies under one explicit ID stop a merge before source documents
are removed. The low-level merger accepts both layouts; the capture writer
converts its result to Conversation and Attachments sections before saving.

`write.ts` owns source-preserving updates. Captures and follow polling pass
structured messages through `commands/all/slack/lib/updateCapture.ts`, with
channel + exact Slack timestamp as message identity and Slack file IDs as
attachment identity. The CLI compatibility adapter recovers file IDs from
agent-slack's documented download filenames until its JSON includes them.
Files without provider IDs get local content IDs; legacy frontmatter-only
files get local IDs and remain unassociated until their source can be matched.
Unavailable files without provider IDs use a deterministic message-and-position
anchor, which remains stable when their original bytes become available.

Each message is an H3 under Conversation. Its file links target standalone
anchors before H3 filename entries under Attachments; those entries link to
the original stored files or provider-confirmed external documents. Original
filenames stay visible, including for attachment-only messages. Captures do not
inspect photos or generate file summaries. Existing inline transcripts and
optional summaries are preserved.

Remote Slack files are pointers: `files.info` restores their external URL when
the compact CLI only returns a failed download receipt. Never archive that receipt
or treat a linked document's HTML as an original file. Unavailable downloads keep
a named attachment entry with a managed pending block, so conversation saves and
follow registration can finish. Only local originals enter YAML `attachments`.
Follow updates revisit pending entries even after the message checkpoint advances;
a successful retry replaces only that block, preserving its anchor and user notes.

Updates promote legacy headings in place and insert replies before the next
H2, retaining manual sections and metadata. Recovering an old message's ID
requires an unambiguous author, minute, and content match against the fetched
source. Ambiguous collisions stop the write instead of guessing ownership.
Legacy file storage names are reused only after byte equality is verified.

Originals live in `attachments/YYYY/MM/DD/<follow-slug>/`. Both frontmatter
and original-file links carry `<follow-slug>/<filename>`, relative to the
day's attachments. A capture without a follow uses its document slug.
Updates copy existing flat files (or files from a merged follow) into that
folder before changing references. Old copies remain until a migration can
verify no other document uses them; a failed save must not break old links.
Missing originals retain their old references until a later fetch recovers them.

Follow polling overlaps the checkpoint minute and deduplicates by message ID.
Replies are filed by notebook day, while known messages keep their previously
assigned document day. Each completed day's reference is persisted before the
next save; the checkpoint advances only after every anchor export and save
succeeds. It records the poll's start, so replies arriving during processing
remain eligible. Repeating a successful update leaves the document unchanged.

Only files identified by Slack as `slack_audio` are transcribed automatically.
The compact CLI drops this distinction, so export restores it with `files.info`
for audio candidates. A complete native transcript is preferred: a preview is
usable only when Slack explicitly says it has no more text; otherwise the full
VTT is fetched. Missing native text falls back to the existing audio recognizer.
Ordinary audio uploads, photos and PDFs remain original files without summaries.

New captures prepare voice transcripts before generating the title and follow
slug. Summary, tag and relationship classification include those words; the
writer receives the same prepared results instead of recognizing the audio
again. Failed preparation is retried on the next fetch, and recognition
checkpoints remain until the conversation has been saved.

Transcripts are inserted into the owning message with `*(voice memo transcript)*`.
A hidden `voice-memo-transcript:<attachment-id>` marker identifies each one, so
multiple voice notes and later additions can be retried independently. Existing
words and manual corrections win. A pre-marker manual transcript is retained
when its file association is unambiguous; ambiguous manual associations stop an
update rather than guessing. Transcript text is escaped so speech cannot create
new document sections or anchors.

Recognition failures still save messages and original files. A missing transcript
keeps an already-known message eligible for follow updates after the checkpoint
has advanced. Paid recognition reuses the audio pipeline's content-keyed retry
record; callers clear it only after saving the conversation. Existing documents
are checked again before replacement so edits made during recognition cause a
retry. Batch backfills use the same writer and preserve the follow's checkpoint.
