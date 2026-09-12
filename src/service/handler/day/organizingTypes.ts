export interface DayItemAddress {
  list: string
  raw: string
  /** The whole task block and the links it resolves, including attached notes. */
  revision: string
}

export type CommitmentOrder = 'time' | 'manual'

export const dayItemKey = (item: { list: string; raw: string }) => JSON.stringify([item.list, item.raw])
