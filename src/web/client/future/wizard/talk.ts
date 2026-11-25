import { decisionThreadId } from '#lib/decisionWizard/thread.ts'
import { stageChatDraft } from '../../chat/chatDraft.ts'
import { futureRequest } from '../request.ts'

/**
 * Open the Sky chat about a decision being worked through, in a new tab.
 *
 * The chat's own thread while it is open. Once it was closed and filed, the
 * conversation is reopened from its file, so it carries on where it stopped.
 * Only a decision with no chat yet starts a new one, with the decision named in
 * the composer so its first message says what it is about.
 *
 * `back` is the page the chat returns to when it ends.
 */
export function talkItThrough(run: string, title: string, back: string): void {
  // The tab opens on the click itself, and is pointed at the chat once it is known which one to open.
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  const show = (thread: string) => {
    const href = `/thread/${encodeURIComponent(thread)}?returnTo=${encodeURIComponent(back)}`
    if (tab && !tab.closed) tab.location.href = href
    else window.location.assign(href)
  }
  const own = decisionThreadId(run)
  void (async () => {
    try {
      const live = await fetch(`/chat/${encodeURIComponent(own)}`).then((response) => response.ok)
      if (live) return show(own)
      const { filed } = await futureRequest<{ thread: string; filed: string | null }>(`/decisions/wizard/${run}/chat`)
      if (filed) {
        const response = await fetch('/chat/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat: filed }),
        })
        const reopened = (await response.json().catch(() => null)) as { id?: string } | null
        if (response.ok && reopened?.id) return show(reopened.id)
      }
      stageChatDraft(own, `About the decision “${title}”: `)
    } catch {
      // Whatever could not be asked, the chat's own thread still opens.
    }
    show(own)
  })()
}
