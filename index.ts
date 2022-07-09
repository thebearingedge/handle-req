import { Router } from './router.js'

const router = new Router()

const jsonResponse = (data: any) => new Response(JSON.stringify(data), {
  headers: {
    'Content-Type': 'application/json'
  }
})

router.get<{ foo: string, baz: string }>('/api/:foo/bar/:baz', ({ params }) => {
  return jsonResponse(params)
})

router.get<{ '*': string }>('/api/1/*', ({ params }) => {
  return jsonResponse(params)
})

Bun.serve({
  port: 3000,
  fetch(req: Request) {
    return router.handle(req)
  }
})
