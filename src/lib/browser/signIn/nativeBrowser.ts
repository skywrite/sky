import { runCommand } from '#lib/sys/mod.ts'

// Keep browser selection explicit. Never attach to, or copy, an everyday browser profile.
export const NATIVE_BROWSER = {
  id: 'brave' as const,
  label: 'Brave (Chromium)',
  executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
}

export async function nativeBrowserAvailable(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const signature = await runCommand(
    '/usr/bin/codesign',
    [
      '--verify',
      '-R',
      '=anchor apple generic and identifier "com.brave.Browser" and certificate leaf[subject.OU] = "KL8N8XSYF4"',
      '/Applications/Brave Browser.app',
    ],
    { timeout: 10000 },
  )
  if (!signature.success) return false
  const entitlements = await runCommand(
    '/usr/bin/codesign',
    ['-d', '--entitlements', ':-', '/Applications/Brave Browser.app'],
    { timeout: 10000 },
  )
  return (
    entitlements.success &&
    /<key>com\.apple\.developer\.web-browser\.public-key-credential<\/key>\s*<true\s*\/>/.test(entitlements.stdout)
  )
}
