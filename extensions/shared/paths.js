/**
 * Shared paths and constants for Node-based extension builds
 *
 * This module provides a single source of truth for:
 * - Webpack loaders
 * - Project directory structure
 * - TypeScript path mappings
 *
 * Used by both vscode and browser extension webpack configs.
 */

const path = require('path')

// Project structure (relative to extensions/ directory)
const projectPaths = {
  notebookShared: path.resolve(__dirname, '..', '..', 'src', '_shared-ts'),
  packageJsonPath: path.resolve(__dirname, '..', '..', 'src', 'package.json'),
}

// TypeScript path mappings (used in webpack resolve.alias)
// Note: These are relative to each extension's directory, not shared/
function getWebpackAliases(extensionDir) {
  return {
    '#shared': projectPaths.notebookShared,
    '#universal': path.join(projectPaths.notebookShared, 'universal'),
    '#config': path.join(projectPaths.notebookShared, 'config.ts'),
  }
}

// Common webpack loader configurations
const tsLoaderConfig = {
  loader: 'ts-loader',
  options: {
    transpileOnly: true,
    compilerOptions: {
      module: 'esnext',
    },
  },
}

const stripTsExtensionLoader = {
  loader: 'string-replace-loader',
  options: {
    search: '\\.ts(\'|")',
    replace: '$1',
    flags: 'g',
  },
}

const replaceImportMetaUrlLoader = {
  loader: 'string-replace-loader',
  options: {
    search: 'import.meta.url',
    replace: "''",
    flags: 'g',
  },
}

module.exports = {
  // Project structure
  projectPaths,

  // Functions
  getWebpackAliases,

  // Common loader configs (ready to use in webpack)
  commonLoaders: {
    tsLoaderConfig,
    stripTsExtensionLoader,
    replaceImportMetaUrlLoader,
  },
}
