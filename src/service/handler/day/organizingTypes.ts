export interface DayItemAddress {
  list: string
  raw: string
  /** Zero-based occurrence of this first line within the list, including identical blocks. */
  occurrence?: number
  /** The whole task block and the links it resolves, including attached notes. */
  revision: string
}

export type CommitmentOrder = 'time' | 'manual'

export const dayItemKey = (item: { list: string; raw: string; occurrence?: number }) =>
  JSON.stringify([item.list, item.raw, ...(item.occurrence ? [item.occurrence] : [])])
