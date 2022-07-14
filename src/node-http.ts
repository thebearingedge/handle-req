import { Readable } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import { Router } from '.'

type OnRequest = Router & ((req: IncomingMessage, res: ServerResponse) => Promise<void>)

export default function hotCross(): OnRequest {

  const router = new Router()

  return new Proxy(router, {
    apply(_,  __, [req, res]: [IncomingMessage, ServerResponse]) {
      void onRequest(req, res)
    }
  }) as OnRequest

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {

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

    const request = new Request(url, { method, headers, body })

    const response: Response = await router(request)

    res.statusCode = response.status

    for (const header of response.headers) res.setHeader(...header)

    if (response.body == null) return void res.end()

    await response.body.pipeTo(new WritableStream({
      write: chunk => void res.write(Buffer.from(chunk)),
      close: () => void res.end()
    }))

  }

}
