import { useEffect, useRef } from 'react'

type DialogTitle = { title: string }

// One observer lets nested dialogs share ownership without fighting each other.
const dialogs: DialogTitle[] = []
let pageTitle = ''
let displayedTitle = ''
let observer: MutationObserver | null = null

function displayTitle() {
  // A page may finish loading or navigate while a dialog covers it.
  if (document.title !== displayedTitle) pageTitle = document.title
  const title = dialogs.at(-1)?.title ?? pageTitle
  displayedTitle = title
  if (document.title !== title) document.title = title
}

function openTitle(dialog: DialogTitle): () => void {
  if (!dialogs.length) {
    pageTitle = document.title
    displayedTitle = pageTitle
    observer = new MutationObserver(displayTitle)
    const element = document.querySelector('title')
    if (element) observer.observe(element, { childList: true, subtree: true, characterData: true })
  }
  dialogs.push(dialog)
  displayTitle()
  return () => {
    dialogs.splice(dialogs.indexOf(dialog), 1)
    displayTitle()
    if (!dialogs.length) {
      observer?.disconnect()
      observer = null
    }
  }
}

/** The latest open dialog owns the tab title; closing it restores the current page or earlier dialog. */
export function useDialogTitle(title: string | null) {
  const dialog = useRef<DialogTitle>({ title: '' })
  const opened = title !== null
  useEffect(() => {
    dialog.current.title = title ?? ''
    if (dialogs.includes(dialog.current)) displayTitle()
  }, [title])
  useEffect(() => {
    if (opened) return openTitle(dialog.current)
  }, [opened])
}
