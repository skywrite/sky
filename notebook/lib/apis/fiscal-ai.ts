import { env } from '#shared/sys/mod.ts'

interface FiscalAiPriceResponse {
  date: string
  price: number
}

export async function fetchEquityPrice(ticker: string, apiKey = env.get('FISCAL_AI_KEY')): Promise<number> {
  if (!apiKey) {
    console.error('FISCAL_AI_KEY environment variable not set')
    return NaN
  }

  try {
    const url = new URL('https://api.fiscal.ai/v1/company/stock-prices')
    url.searchParams.set('ticker', ticker)
    url.searchParams.set('latest', 'true')

    const response = await fetch(url.toString(), {
      headers: {
        'X-Api-Key': apiKey,
      },
    })

    if (!response.ok) {
      console.error(`Fiscal.ai API error for ${ticker}: ${response.status} ${response.statusText}`)
      return NaN
    }

    const data: FiscalAiPriceResponse[] = await response.json()

    if (!data || data.length === 0) {
      console.error(`No price data returned for ${ticker}`)
      return NaN
    }

    return data[0].price
  } catch (error) {
    console.error(`Error fetching price for ${ticker}:`, error)
    return NaN
  }
}
