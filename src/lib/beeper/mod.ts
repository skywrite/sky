// Beeper Desktop: the local API, its sign-in, the keychain entry, and the
// capture that turns its chats into saved messages.

export { BEEPER_BASE_URL, BEEPER_NOT_RUNNING, BeeperClient, BeeperError, beeperInfo } from './client.ts'
export type {
  BeeperAccount,
  BeeperAttachment,
  BeeperChat,
  BeeperClientOptions,
  BeeperFailure,
  BeeperInfo,
  BeeperMessage,
  BeeperPage,
  BeeperUser,
  ChatSearch,
} from './client.ts'
export {
  BEEPER_SCOPES,
  buildBeeperAuthUrl,
  exchangeBeeperCode,
  grantExpired,
  grantExpiry,
  registerBeeperClient,
  startBeeperSignIn,
} from './oauth.ts'
export type { BeeperGrant, BeeperSignIn } from './oauth.ts'
export {
  BEEPER_GRANT_ENTRY,
  BEEPER_SECRETS_CATEGORY,
  deleteBeeperGrant,
  loadBeeperGrant,
  saveBeeperGrant,
} from './secrets.ts'
export { beeperText, decodeEntities } from './text.ts'
export { BeeperSyncStateSchema, isSlackAccount, loadBeeperSyncState, syncBeeper } from './capture.ts'
export type { BeeperSource, BeeperSyncOptions, BeeperSyncResult, BeeperSyncState } from './capture.ts'
