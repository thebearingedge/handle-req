import { Server } from 'http'
import request from 'supertest'
import hotCross from './node-http'

describe('hotCross()', () => {

  let router: ReturnType<typeof hotCross>
  let client: ReturnType<typeof request>

  beforeEach(() => {
    router = hotCross()
    client = request(new Server(router))
  })

  it('handles node http requests', async () => {
    router.get('/api/foo', () => new Response('ok'))
    await client
      .get('/api/foo')
      .expect(200, 'ok')
  })

})
