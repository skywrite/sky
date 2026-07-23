import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Locally installed VS Code executable, if present (avoids a download). */
function findLocalVSCode(): string | undefined {
  const macOSPath = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
  return fs.existsSync(macOSPath) ? macOSPath : undefined
}

async function main() {
  try {
    // No bundle step: the extension loads from source and the test entry is a
    // .ts module the host strips at load, same as the extension itself.
    const extensionDevelopmentPath = path.resolve(dirname, '../../')
    const extensionTestsPath = path.resolve(dirname, 'suite/index.ts')

    const forceDownload = process.env.VSCODE_DOWNLOAD === 'true'
    const localVSCode = forceDownload ? undefined : findLocalVSCode()

    const exitCode = await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(localVSCode
        ? { vscodeExecutablePath: localVSCode }
        : {
            version: 'stable',
            cachePath: '/tmp/vscode-test-cache',
          }),
      launchArgs: [
        '--user-data-dir=/tmp/vscode-test-userdata',
        '--extensions-dir=/tmp/vscode-test-extensions',
        '--disable-extensions',
        '--disable-workspace-trust',
        '--disable-gpu',
      ],
    })

    if (exitCode !== 0) {
      console.error(`Tests failed with exit code ${exitCode}`)
      process.exit(exitCode)
    }
    console.log('All tests passed!')
    process.exit(0)
  } catch (err) {
    console.error('Failed to run tests:', err)
    console.error('Error stack:', (err as Error).stack)
    process.exit(1)
  }
}

main()
