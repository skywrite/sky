/** Error encountered during store build */
export interface StoreError {
  path: string
  error: string
}

/** Warning for files that parsed but have issues */
export interface StoreWarning {
  path: string
  warning: string
}
