import { Router } from './router.js'

const jsonResponse = (data: any) => new Response(JSON.stringify(data), {
  headers: {
    'Content-Type': 'application/json'
  }
})

const router = new Router()
  .get<'foo' | 'baz'>('/api/:foo/bar/:baz', ({ params }) => {
    return jsonResponse(params)
  })
  .get('/api/hi-there', ({ next }) => {
    return next()
  })

Bun.serve({
  fetch: router.handle
})
