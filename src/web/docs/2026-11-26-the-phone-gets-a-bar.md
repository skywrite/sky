---
created: 2026-11-26
updated: 2026-11-26
---

# The phone gets a bar

Once Sky was installed on a phone, two things stood out.
The search field sat above every page, settings included, so each screen had two headers:
the field, and the page's own back link under it.
Everything else lived behind a menu button whose drawer changed its contents by section.
On a settings page it became the settings list, with Today and Chat gone from it.
Settings had no page of its own, and its pages were reached by opening the drawer again each time.

Below 900px, where the drawer used to take over, a bar at the bottom now holds Today, Future and Chat,
the sidebar's three primary rows, plus More.
Search is a round button of its own beside the bar.
Search is used often enough to keep one tap, and taking it out of the header lets each page start with its own title.

More floats over the page above the bar, with a list of everything the drawer held beyond the primary rows.
A full page for More was mocked beside it.
That page was simpler, but it was one more page to pass through, and the panel keeps the page you came from in sight.
Keeping the drawer with fixed contents behind a slim top bar was also considered.
It would have fixed the changing menu, but everything would still have sat behind a button.

Each part of the old drawer moved to the page it belongs to.
The days open from the day's date.
Live chats are listed on an empty chat, and a chat opened from that list goes back to it.
Settings gets a list of every section at `/settings`, which a wide screen still answers with Appearance beside the sidebar.
Explorer's path links each folder, because the tree was the only way up a level on a phone.

Pages end above the bar instead of scrolling under it.
That way no page needs padding of its own, and a page with something fixed at its foot, like the message box,
keeps it above the bar.
A conversation hides the bar, so the messages and the message box get the whole screen.

The phone's home indicator decides how low the bar can sit.
The page does not opt into the full screen with `viewport-fit=cover`,
so the bar keeps a small offset from the bottom whether or not the safe area reads as zero.
Several styles had made room for the old menu button: the chat header's tabs, Explorer's tabs, and the Details rail's corner.
Those offsets went with the button.
