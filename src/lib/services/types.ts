export type Service = {
  shortLabel: string
  label: string
  plistFilePath: string
}

export type ServiceListStatus = {
  label: string
  pid: string
  lastCode: number
}

export type ServiceStatus = {
  label: string
  installed: boolean // plist file present in ~/Library/LaunchAgents
  loaded: boolean // launchctl load
  running: boolean // launchctl list returns pid
  pid: string
  lastError: boolean
}
