import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Locally installed VS Code executable, if present (avoids a download).
 *
 * VS Code 1.131 renamed the macOS binary from Electron to Code, so both names
 * are tried — checking only the old one silently fell through to the download
 * path, which then spawned that same missing name and failed with ENOENT.
 * Returns undefined off macOS (CI included), where the download path is used.
 */
function findLocalVSCode(): string | undefined {
  const macOSPaths = [
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ]
  return macOSPaths.find((path) => fs.existsSync(path))
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
