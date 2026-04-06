import { env } from '#shared/sys/mod.ts'

export async function fetchEquityPrice(ticker: string, apiKey = env.get('ALPHA_VANTAGE_API_KEY')): Promise<number> {
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${apiKey}`
    const response = await fetch(url)
    const data = await response.json()

    if (data['Error Message'] || data['Note']) {
      console.error('Error:', data['Error Message'] || data['Note'])
      return NaN
    }

    if (data['Information']) {
      if (/rate limit/i.test(data['Information'])) {
        console.error('Hit AlphaVantage Rate Limit.')
        return NaN
      }
    }

    const globalQuote = data['Global Quote']
    const latestClose = globalQuote['05. price']

    return parseFloat(latestClose)
  } catch (error) {
    console.error(error)
    return NaN
  }
}
