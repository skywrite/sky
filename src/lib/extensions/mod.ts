export {
  addExtension,
  type AddOutcome,
  type EnableOutcome,
  linkSharedPackages,
  removeExtension,
  type RemoveOutcome,
  setExtensionEnabled,
} from './install.ts'
export {
  disabledMarker,
  EXTENSIONS_DIR,
  extensionCommandRoots,
  type ExtensionCommandRoot,
  type InstalledExtension,
  listInstalled,
} from './installed.ts'
export {
  authorHandle,
  EXTENSION_CATEGORIES,
  type ExtensionCategory,
  type ExtensionManifest,
  ExtensionManifestSchema,
  MANIFEST_VERSION,
  readManifest,
} from './manifest.ts'
