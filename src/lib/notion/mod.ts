// Notion: the sign-in for its MCP server, the keychain entry, and the client
// that calls the tools Notion runs for AI apps.

export { cleanLink, NotionClient, openNotion, pageOf, searchOf, selfOf } from './client.ts'
export type {
  NotionClientOptions,
  NotionMatch,
  NotionPage,
  NotionParent,
  NotionSearch,
  NotionSelf,
  NotionTarget,
  NotionTeamspace,
  NotionValue,
} from './client.ts'
export { NOTION_NOT_CONNECTED, NOTION_SIGNED_OUT, NOTION_UNREACHABLE, NotionError } from './errors.ts'
export type { NotionFailure } from './errors.ts'
export {
  buildNotionAuthUrl,
  discoverNotionAuth,
  exchangeNotionCode,
  grantExpired,
  grantExpiry,
  NOTION_MCP_URL,
  refreshNotionGrant,
  registerNotionClient,
  revokeNotionGrant,
  startNotionSignIn,
} from './oauth.ts'
export type { NotionAuthServer, NotionGrant, NotionSignIn } from './oauth.ts'
export {
  deleteNotionGrant,
  loadNotionGrant,
  NOTION_GRANT_ENTRY,
  NOTION_SECRETS_CATEGORY,
  saveNotionGrant,
} from './secrets.ts'
