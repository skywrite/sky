---
created: 2026-09-07
updated: 2026-09-07
---

# Files clipped into chat

The web host already offered `read_file`, but a browser drop supplied neither
an accessible server path nor an attachment in the conversation. A file such
as `Atlas proposal.pdf` needed to travel with the question itself.

The composer keeps browser File objects until Send. It supports dropping on
the conversation, a paperclip picker, and clipboard files. A rejected request
leaves both the question and removable clips intact. File-only messages get
a reading request. Text-only clients continue using the existing JSON route;
uploads use multipart with that same JSON settings envelope and file bytes.

The route bounds and validates uploads, reserves the turn, then stages each
file long enough to run the existing console reader. The reader handles the
format conversion, text truncation, naming, and content deduplication in the
notebook's day attachments. Staging files are removed in a finally block.
The model receives document text or native PDF/image parts on its user message.
Its file header points at the durable copy, not the deleted staging path.

The transcript needs a useful representation without embedding those contents
in the visible conversation. Its user message ends with normal markdown links
carrying a paperclip label and a `/chat/files/<day>/<filename>` destination.
The browser recognizes only trailing links with that shape and renders them
as file clips; other message text keeps its existing rendering. The server
streams the canonical message before the reply so the optimistic browser
clips become the same durable links a reload reads. Thread titles use the
question without attachment markup.

Those links also make an interrupted message resendable without the original
browser File. Recovery carries the full model history and attachment metadata.
On a saved chat or branch, the host supplies the local paths behind previous
clips so `read_file` can read them again. File downloads use sanitized day and
filename segments, a download disposition, and nosniff, and are independent of
whether a live thread still exists.

Verification uses synthetic documents and a scripted model through real
sessions. Route checks cover text, PDF and image inputs, original downloads,
recovery, metadata after filing, link-only resends, unsafe paths, malformed
requests, empty and unsupported files, count/size limits, and file-only sends.
A browser test exercises drop, removal, picker, paste, model input, downloads,
reloads, failed upload correction, title rendering, and long filenames on
phones. Existing console reader, chat engine, session, and route tests remain
part of the regression check.
