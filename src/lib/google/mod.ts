// Google Workspace integration: BYO-client OAuth with everything stored in the
// OS keychain, a thin authenticated fetch client, and Drive search/read
// primitives. No googleapis dependency — the API surface we use is small.

export {
  GOOGLE_SCOPES,
  GoogleAuthError,
  buildAuthUrl,
  exchangeCode,
  fetchAccountEmail,
  generatePkce,
  randomState,
  refreshAccessToken,
} from './oauth.ts'
export type { OAuthClient, PkcePair, TokenResponse } from './oauth.ts'

export { startLoopback } from './loopback.ts'
export type { LoopbackServer } from './loopback.ts'

export {
  CLIENT_ENTRY_NAME,
  GOOGLE_SECRETS_CATEGORY,
  deleteAccountTokens,
  listAccountEmails,
  loadAccountTokens,
  loadOAuthClient,
  parseStoredTokens,
  saveAccountTokens,
  saveOAuthClient,
  serializeStoredTokens,
} from './tokens.ts'
export type { StoredTokens } from './tokens.ts'

export { AccountResolutionError, AmbiguousAccountError, resolveAccountEmail } from './accounts.ts'

export { GoogleApiError, GoogleClient } from './client.ts'
export type { GoogleClientOptions } from './client.ts'

export {
  DRIVE_FILES_URL,
  DRIVE_UPLOAD_URL,
  EXPORT_MIME,
  UPLOADED_SPREADSHEET_FORMATS,
  WORKSPACE_MIME,
  buildBinaryMultipartBody,
  buildFilesQuery,
  buildMultipartBody,
  conversionTarget,
  copyFile,
  createDocFromMarkdown,
  deleteFile,
  escapeDriveQueryValue,
  exportFile,
  exportFileBytes,
  getFile,
  importFileAsDoc,
  listFiles,
  renameFile,
  replaceFileWithMarkdown,
  searchFiles,
  shareFile,
  uploadFile,
  uploadedSpreadsheetFormat,
  workspaceKind,
} from './drive.ts'
export type { DriveFile, ShareRole, WorkspaceKind } from './drive.ts'

export {
  TWIN_SOURCE_KEY,
  TWIN_SOURCE_MODIFIED_KEY,
  ensureConvertedTwin,
  findConvertedTwin,
  twinName,
  twinProperties,
} from './convertedTwin.ts'
export type { ConvertedTwin } from './convertedTwin.ts'

export {
  DOCS_ALLOWED_REQUESTS,
  DOCS_API_URL,
  batchUpdateDoc,
  getDocOutline,
  getDocTabTexts,
  listDocSuggestionIds,
  listDocSuggestions,
  listDocTabs,
  summarizeDocument,
  validateDocsRequests,
} from './docs.ts'
export type { DocOutline, DocOutlineEntry, DocSuggestion, DocTabInfo, DocTabOutline, DocTabText } from './docs.ts'

export {
  SLIDES_ALLOWED_REQUESTS,
  SLIDES_API_URL,
  batchUpdateSlides,
  computeElementCenterEmu,
  createPresentation,
  fetchThumbnailPng,
  getElementAnchor,
  getPresentationOutline,
  getSlideThumbnail,
  presentationUrl,
  summarizePresentation,
  validateSlidesRequests,
} from './slides.ts'
export type { ElementAnchor, PresentationOutline, SlideElementSummary, SlideSummary, SlideThumbnail } from './slides.ts'

export { EMU_PER_PT, SLIDE_DESIGN, SLIDE_THEMES, hexToRgb01, slideDesignPromptSection } from './design.ts'
export type { RgbColor, SlideTheme } from './design.ts'

export {
  SHEETS_ALLOWED_REQUESTS,
  SHEETS_API_URL,
  batchUpdateSpreadsheet,
  createSpreadsheet,
  extractChartIds,
  getSpreadsheetOutline,
  getValues,
  setValues,
  spreadsheetUrl,
  summarizeSpreadsheet,
  validateSheetsRequests,
} from './sheets.ts'
export type { CreatedSpreadsheet, SheetTabSummary, SpreadsheetOutline, UpdatedValues } from './sheets.ts'

export { isLikelyFileId, parseGoogleUrl, resolveFileRef } from './parseGoogleUrl.ts'
export type { ParsedGoogleUrl } from './parseGoogleUrl.ts'

export { csvToValues } from './csv.ts'

export { compactComments, createComment, createReply, deleteComment, listComments } from './comments.ts'
export type { CompactComment, DriveComment, DriveReply } from './comments.ts'

export { MAX_IMAGE_BYTES, driveImageUrl, sniffImageMime } from './images.ts'
export type { ImageMime } from './images.ts'

export {
  CALENDAR_API_URL,
  CALENDAR_READONLY_SCOPE,
  hasCalendarScope,
  listEvents,
  meetingDropReason,
} from './calendar.ts'
export type { CalendarAttendee, CalendarEvent } from './calendar.ts'

export {
  GMAIL_API_URL,
  GMAIL_SCOPE,
  createDraft,
  draftUrl,
  getAttachment,
  getMessage,
  getThread,
  hasGmailScope,
  listLabels,
  listThreads,
  modifyThread,
  parseRecipients,
  resolveLabel,
  resolveLabelId,
  threadIdFromDecimal,
  threadIdToDecimal,
} from './gmail.ts'
export type { GmailAddress, GmailAttachment, GmailDraft, GmailLabel, GmailMessage, GmailThreadRef } from './gmail.ts'

export { renderEmailHtml } from './emailHtml.ts'
