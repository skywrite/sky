import http from 'node:http'
import type { AddressInfo } from 'node:net'
import url from 'node:url'
import ngrok from '@ngrok/ngrok'
import open from 'open'
import QRCode from 'qrcode'

export type Location = {
  latitude: number
  longitude: number
}

/**
 * Fetch location using mobile device via QR code and ngrok
 * This method opens a QR code that can be scanned with a mobile device
 * to get GPS location from the phone's browser
 *
 * @param authtoken Ngrok auth token for creating tunnel
 * @returns Location data from mobile device
 */
export function fetchMobileLocation(authtoken: string): Promise<Location> {
  return new Promise((resolve, reject) => {
    let ngrokListener: ngrok.Listener

    const server = http.createServer(async (req, res) => {
      const reqUrl = url.parse(req.url!, true)
      // console.log(reqUrl.pathname)

      switch (reqUrl.pathname) {
        case '/': {
          const serverAddress = `${ngrokListener.url()}/location`
          try {
            const qrCodeSVG = await QRCode.toString(serverAddress, { type: 'svg', width: 200 })
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              `<title>Fetch Location</title><div style="display: flex; justify-content: center; align-items: center; height: 100vh;">${qrCodeSVG}</div>`,
            )
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('Error generating QR code')
          }
          break
        }
        case '/location': {
          const htmlContent = `
                <script>
                  (${getLocation.toString()})();
                </script>`
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(htmlContent)
          break
        }
        case '/location-results': {
          if (req.method === 'POST') {
            let data = ''
            req.on('data', (chunk) => {
              data += chunk
            })
            req.on('end', () => {
              // console.log('Location Data Received:', data)
              res.writeHead(200, { 'Content-Type': 'text/plain' })
              res.end('Location received')

              server.close(() => {
                const location: Location = JSON.parse(data)
                resolve(location)
              })
            })
          }
          break
        }
        case '/favicon.ico': {
          const svgFavicon = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="#89CFF0"/></svg>`
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Content-Length': new TextEncoder().encode(svgFavicon).byteLength,
          })
          res.end(svgFavicon)
          break
        }
        default:
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
          reject(`${reqUrl.pathname} does not exist.`)
          break
      }
    })

    server.listen(async () => {
      const address = server.address() as AddressInfo
      const port = address.port as number

      // console.log(`Server running at http://localhost:${port}/`);
      ngrokListener = await ngrok.connect({ addr: port, authtoken })

      // console.log(`Ingress established at: ${ngrokListener.url()}`)

      await open(`${ngrokListener.url()}`)
    })
  })
}

export default fetchMobileLocation

// runs client-side in the browser
function getLocation() {
  navigator.geolocation.getCurrentPosition((position) => {
    fetch('/location-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
    })
  })
}
