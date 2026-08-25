import * as os from 'node:os'
import * as path from 'node:path'
import { loadSkyConfig } from './config/loader.ts'
import type { AiProfileConfig } from './config/types.ts'

export type { AiProfileConfig, SkyConfig } from './config/types.ts'
export { SKY_CONFIG_DIR, SKY_CONFIG_PATH } from './config/loader.ts'

const skyConfig = loadSkyConfig()

// ── From config ────────────────────────────────────────────────

export const DIR_BASE = skyConfig.dir
export const DIR_USER_DATA = skyConfig.userDataDir
export const DIR_CODE = skyConfig.codeDir
export const DIR_INPUT = skyConfig.inputDir
export const DIR_OUTPUT = skyConfig.outputDir
export const EDITOR = skyConfig.editor
export const CATEGORIES = skyConfig.categories
export const DEFAULT_CATEGORY = skyConfig.categories[0]
export const COMMAND_DIRS = skyConfig.commands.dirs
export const DAY_START_COMMANDS = skyConfig.commands.day.start
export const DAY_END_COMMANDS = skyConfig.commands.day.end
export const BINS = skyConfig.bins
export const AI_MODELS = skyConfig.ai.models
export const AI_PROFILES: Record<string, AiProfileConfig> = skyConfig.ai.profiles ?? {}
export const PORT_SERVER = skyConfig.server.port
export const SLACK_WORKSPACE = skyConfig.slack.workspace
export const NBFS_LAYOUT = skyConfig.nbfs.layout

// ── Derived from config (convention) ───────────────────────────

export const DIR_HOME = os.homedir()
export const DIR_DESKTOP = path.join(DIR_HOME, 'Desktop')
export const DIR_USER_SERVICES = path.join(DIR_HOME, 'Library', 'LaunchAgents')
export const DIR_TMP_SYS = os.tmpdir()

export const DIR_ATTACHMENTS = path.join(DIR_USER_DATA, 'attachments')
export const DIR_STATE = path.join(DIR_USER_DATA, 'state')
export const DIR_STATE_FOLLOW_EMAIL_ACTIVE = path.join(DIR_STATE, 'follow', 'email', 'active')
export const DIR_STATE_FOLLOW_EMAIL_ARCHIVE = path.join(DIR_STATE, 'follow', 'email', 'archive')
export const DIR_STATE_FOLLOW_SLACK_ACTIVE = path.join(DIR_STATE, 'follow', 'slack', 'active')
export const DIR_STATE_FOLLOW_SLACK_ARCHIVE = path.join(DIR_STATE, 'follow', 'slack', 'archive')
export const DIR_TMP_USER = path.join(DIR_USER_DATA, 'tmp')

export const DIR_CODE_SRC = path.join(DIR_CODE, 'src')
export const DIR_CODE_SRC_COMMANDS = path.join(DIR_CODE_SRC, 'commands')
export const DIR_CODE_SERVICES = path.join(DIR_CODE, 'services')

// AI-owned space: the assistant may create/update/delete inside ai/ (today
// just ai/memory/, the cross-session chat memory) without per-item approval —
// unlike the rest of the notebook, which only deliberate capture flows write.
export const DIR_AI = path.join(DIR_BASE, 'ai')
export const DIR_AI_MEMORY = path.join(DIR_AI, 'memory')

export const DIR_DATA = path.join(DIR_BASE, 'data')
export const DIR_DATA_ASSETS = path.join(DIR_DATA, 'assets')
export const DIR_DATA_LOCATION = path.join(DIR_DATA, 'location')
export const DIR_DATA_TRACKING = path.join(DIR_DATA, 'tracking')
export const DIR_DATA_WEATHER = path.join(DIR_DATA, 'weather')

export const DIR_DECISIONS = path.join(DIR_BASE, 'decisions')
export const DIR_GOALS = path.join(DIR_BASE, 'goals')
export const DIR_IDEAS = path.join(DIR_BASE, 'ideas')
export const DIR_LIBRARY = path.join(DIR_BASE, 'library')
export const DIR_PEOPLE = path.join(DIR_BASE, 'people')
export const DIR_PEOPLE_OLD = path.join(DIR_BASE, 'people-old')
export const DIR_PLACES = path.join(DIR_BASE, 'places')
export const DIR_PLACES_LOCATIONS = path.join(DIR_PLACES, 'locations')
export const DIR_PROJECTS = path.join(DIR_BASE, 'projects')
export const DIR_PROJECTS_OPEN = path.join(DIR_PROJECTS, 'open')
export const DIR_STREAKS = path.join(DIR_BASE, 'streaks')
export const DIR_TIME = path.join(DIR_BASE, 'time')
export const DIR_TRACKING = path.join(DIR_BASE, 'tracking')
export const DIR_ORGS = path.join(DIR_BASE, 'orgs')

// Walk order matters: DIR_ORGS before DIR_PROJECTS so orgs are loaded when tracking project references
export const DIRS_MARKDOWN = [
  DIR_AI,
  DIR_DECISIONS,
  DIR_GOALS,
  DIR_IDEAS,
  DIR_LIBRARY,
  DIR_ORGS,
  DIR_PEOPLE,
  DIR_PEOPLE_OLD,
  DIR_PLACES,
  DIR_PROJECTS,
  DIR_STREAKS,
  DIR_TIME,
  DIR_TRACKING,
]

export const FILE_SKY_CODE_ENV = path.join(DIR_CODE_SRC, '.env')

export const FILE_NEXT_PROFESSIONAL = path.join(DIR_TIME, 'next-professional.md')
export const FILE_NEXT_PERSONAL = path.join(DIR_TIME, 'next-personal.md')

export const FILE_RECURRING_PROFESSIONAL = path.join(DIR_TIME, 'recurring-professional.md')
export const FILE_RECURRING_PERSONAL = path.join(DIR_TIME, 'recurring-personal.md')

export const FILE_SCHEDULE_PROFESSIONAL = path.join(DIR_TIME, 'schedule-professional.md')
export const FILE_SCHEDULE_PERSONAL = path.join(DIR_TIME, 'schedule-personal.md')

export const FILE_REMINDERS = path.join(DIR_TIME, 'reminders.md')

export const FILE_ABOUT_ME = path.join(DIR_BASE, 'journal', 'about-me.md')

export const FILE_GOALS_PERSONAL = path.join(DIR_GOALS, 'personal.md')
export const FILE_GOALS_PROFESSIONAL = path.join(DIR_GOALS, 'professional.md')
