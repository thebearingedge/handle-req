import { Readable } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import { Router } from './router'

type HotCross = Router & ((req: IncomingMessage, res: ServerResponse) => Promise<void>)

export default function hotCross(): HotCross {

  const router = new Router()

  return new Proxy(router, {
    apply(_,  __, [req, res]: [IncomingMessage, ServerResponse]) {
      void onRequest(req, res)
    }
  }) as HotCross

  async function onRequest(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {

    try {
      const webReq = createWebRequest(nodeReq)
      const webRes: Response = await router.fetch(webReq)

      nodeRes.statusCode = webRes.status

      for (const header of webRes.headers) nodeRes.setHeader(...header)

      if (webRes.body == null) return void nodeRes.end()

      await webRes.body.pipeTo(new WritableStream({
        write: chunk => void nodeRes.write(chunk),
        close: () => void nodeRes.end()
      }))

      /* c8 ignore next 4 */
    } catch (err) {
      nodeRes.destroy()
      throw err
    }

  }

}

function createWebRequest(req: IncomingMessage): Request {

  const {
    host = 'localhost',
    'x-forwarded-proto': protocol = 'http'
  } = req.headers
  const url = new URL(`${protocol}://${host}${req.url}`)
  const method = req.method as string
  const headers = new Headers()

  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1])
  }

  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : Readable.toWeb(req)

  return new Request(url, { method, headers, body })
}
