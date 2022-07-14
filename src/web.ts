import { Router } from './router.js'

type HotCross = Router & ((req: Request) => Promise<Response>)

export default function hotCross(): HotCross {

  const router = new Router()

  return new Proxy(router, {
    apply(_, __, [req]: [Request]) {
      return router.fetch(req)
    }
  }) as HotCross

}
