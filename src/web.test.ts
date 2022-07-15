import { expect } from 'chai'
import hotCross from './web.js'
import { ok, get } from './index.test.js'

describe('web', () => {

  let router: ReturnType<typeof hotCross>

  beforeEach('instantiate a new router', () => (router = hotCross()))

  describe('method(path: pattern, ...handlers: Handler[])', () => {

    it('throws on duplicate exact routes', () => {
      router.get('/api/foo', () => ok())
      expect(() => {
        router.get('/api/foo', () => ok())
      }).to.throw(Error, 'GET route conflict: /api/foo - /api/foo')
    })

    it('throws on duplicate dynamic routes', () => {
      router.get('/api/:foo/baz', () => ok())
      expect(() => {
        router.get('/api/:bar/baz', () => ok())
      }).to.throw(Error, 'GET route conflict: /api/:bar/baz - /api/:foo/baz')
    })

    it('throws on duplicate catch-all routes', () => {
      router.get('/api/foo/*', () => ok())
      expect(() => {
        router.get('/api/foo/*', () => ok())
      }).to.throw(Error, 'GET route conflict: /api/foo/* - /api/foo/*')
    })

    it('does not throw on duplicate routes for different methods', () => {
      expect(() => {
        router.get('/api/:foo/*', () => ok())
        router.put('/api/:foo/*', () => ok())
        router.post('/api/:foo/*', () => ok())
        router.head('/api/:foo/*', () => ok())
        router.patch('/api/:foo/*', () => ok())
        router.delete('/api/:foo/*', () => ok())
        router.options('/api/:foo/*', () => ok())
      }).not.to.throw()
    })

  })

  describe('fetch(req: Request)', () => {

    describe('no match', () => {

      it('returns a 404 response by default', async () => {
        const res = await router(get('/'))
        expect(res).to.have.property('status', 404)
      })

      it('returns a 404 response when no route is matched', async () => {
        router.get('/foo', () => ok())
        const res = await router(get('/bar'))
        expect(res).to.have.property('status', 404)
      })

    })

    describe('static routes', () => {

      it('hits a static route', async () => {
        router.get('/foo', () => ok('a'))
        const res = await router(get('/foo'))
        expect(await res.text()).to.equal('a')
      })

      it('hits a static nested route', async () => {
        router
          .get('/foo', () => ok('a'))
          .get('/foo/bar', () => ok('b'))
        const res = await router(get('/foo/bar'))
        expect(await res.text()).to.equal('b')
      })

      it('does not find routes for partial matches', async () => {
        router.get('/foo/bar/baz', () => ok())
        const res = await router(get('/foo/bar'))
        expect(res).to.have.property('status', 404)
      })

    })

    describe('dynamic routes', () => {

      it('hits a dynamic route', async () => {
        router.get<{ any: string }>('/foo/:any', ({ params }) => {
          return ok(params.any)
        })
        const res = await router(get('/foo/qux'))
        expect(await res.text()).to.equal('qux')
      })

      it('hits a dynamic route with multiple parameters', async () => {
        router
          .get('/foo/bar/baz/qux', () => ok())
          .get('/foo/:bar/baz/:qux', ({ params }) => {
            return ok(`${params.bar}${params.qux}`)
          })
        const res = await router(get('/foo/1/baz/2'))
        expect(await res.text()).to.equal('12')
      })

      it('collects multiple params of same key into an array', async () => {
        router.get('/foo/:bar/baz/:bar/qux/:bar', ({ params }) => {
          return ok(String(params.bar))
        })
        const res = await router(get('/foo/1/baz/2/qux/3'))
        expect(await res.text()).to.equal('1,2,3')
      })

      it('hits a longer dynamic route', async () => {
        router
          .get('/foo/:bar', () => ok('2'))
          .get('/foo/:baz/qux', ({ params }) => ok(params.baz))
        const res = await router(get('/foo/1/qux'))
        expect(await res.text()).to.equal('1')
      })

      it('hits a static route first', async () => {
       router
          .get('/foo/:bar', () => ok('a'))
          .get('/foo/bar', () => ok('b'))
        const res = await router(get('/foo/bar'))
        expect(await res.text()).to.equal('b')
      })

    })

    describe('catch-all routes', () => {

      it('only allows catch-all at the end of path', () => {
        expect(() => {
          router.get('/foo/*/bar', () => ok())
        }).to.throw(Error, 'invalid route /foo/*/bar')
      })

      it('hits a catch-all route', async () => {
        router
          .get('/foo/*', ({ params }) => ok(params['*']))
        const res = await router(get('/foo/bar/baz'))
        expect(await res.text()).to.equal('bar,baz')
      })

      it('hits a static route first', async () => {
        router
          .get('/foo/*', () => ok('a'))
          .get('/foo/bar', () => ok('b'))
        const res = await router(get('/foo/bar'))
        expect(await res.text()).to.equal('b')
      })

      it('hits a dynamic route first', async () => {
        router
          .get('/foo/*', () => ok('a'))
          .get('/foo/:bar', () => ok('b'))
        const res = await router(get('/foo/bar'))
        expect(await res.text()).to.equal('b')
      })

      it('hits a catch-all route after exhausting static and dynamic routes', async () => {
        router
          .get('/foo/:bar/qux', () => ok('a'))
          .get('/foo/*', ({ params }) => ok(params['*']))
        const res = await router(get('/foo/bar/baz'))
        expect(await res.text()).to.equal('bar,baz')
      })

    })

    describe('handler stacks', () => {

      it('runs handler stack', async () => {
        router.get('/', [
          ({ next }) => next(),
          () => ok('done')
        ])
        const res = await router(get('/'))
        expect(await res.text()).to.equal('done')
      })

      it('returns a 501 response when no response is returned', async () => {
        // @ts-expect-error assume no type checking
        router.get('/', () => {})
        const res = await router(get('/'))
        expect(res).to.have.property('status', 501)
      })

    })

  })

})
