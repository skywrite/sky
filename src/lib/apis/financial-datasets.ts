import { env } from '#shared/sys/mod.ts'

interface PriceSnapshotResponse {
  snapshot: {
    ticker: string
    price: number
    time: string
    day_change: number
    day_change_percent: number
  }
}

export async function fetchEquityPrice(ticker: string, apiKey = env.get('FINANCIAL_DATA_SETS_KEY')): Promise<number> {
  if (!apiKey) {
    console.error('FINANCIAL_DATA_SETS_KEY environment variable not set')
    return NaN
  }

  try {
    const url = `https://api.financialdatasets.ai/prices/snapshot?ticker=${ticker}`

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,
      },
    })

    if (!response.ok) {
      console.error(`FinancialDatasets API error for ${ticker}: ${response.status} ${response.statusText}`)
      return NaN
    }

    const data: PriceSnapshotResponse = await response.json()

    if (!data?.snapshot?.price) {
      console.error(`No price data returned for ${ticker}`)
      return NaN
    }

    return data.snapshot.price
  } catch (error) {
    console.error(`Error fetching price for ${ticker}:`, error)
    return NaN
  }
}
