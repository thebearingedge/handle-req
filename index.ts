type Next = () => Response | Promise<Response>

type Context = {
  next: Next
  req: Request
}

type Handler = (ctx: Context) => Response | Promise<Response>

class Endpoint {

  middleware: Handler[]

  constructor(middleware: Handler[] = []) {
    this.middleware = middleware
  }

  async handle(req: Request, next: Next = notImplemented): Promise<Response> {
    const stack = [...this.middleware]
    return (async function _next(layer: number): Promise<Response> {
      if (layer === stack.length) return next()
      return await stack[layer]({ req, next: () => _next(layer + 1) }) ?? next()
    })(0)
  }

}

const notImplemented = () => new Response(null, { status: 501 })

const logReqMethod: Handler = ({ req, next }) => {
  console.log('received a request', req.method)
  return next()
}

const logReqUrl: Handler = ({ req, next }) => {
  console.log(`request was for ${req.url}`)
  return next()
}

const logReqTime: Handler = ({ next }) => {
  console.log('received the request at', new Date().toUTCString())
  return next()
}

const handleRequest: Handler = () => {
  return new Response(JSON.stringify({ hi: 'there'}), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

async function test(): Promise<void> {
  const ep = new Endpoint([logReqMethod, logReqTime, logReqUrl, handleRequest])
  const res = await ep.handle(new Request('route:///'), notImplemented)
  console.log(res)
}

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

class Segment {

  pattern: string
  endpoint?: Endpoint
  children: Segment[] = []

  constructor(pattern: string) {
    this.pattern = pattern
  }

  append([next, ...rest]: string[], endpoint: Endpoint): void {
    if (next == null) {
      this.endpoint = endpoint
      return
    }
    const child = this.children.find(({ pattern }) => pattern === next)
    if (child != null) {
      child.append(rest, endpoint)
      return
    }
    const segment = new Segment(next)
    segment.append(rest, endpoint)
    this.children.push(segment)
    this.children.sort(({ pattern: a }, { pattern: b }) => a < b ? 1 : -1)
  }

}

class Router {

  routes: Record<string, string> = Object.create(null)
  methods: Record<HTTPMethod, Segment> = Object.create(null)

  get = this._when.bind(this, 'GET')
  put = this._when.bind(this, 'PUT')
  post = this._when.bind(this, 'POST')
  patch = this._when.bind(this, 'PATCH')
  delete = this._when.bind(this, 'DELETE')

  private _when(method: HTTPMethod, path: string, endpoint: Endpoint): this {
    const patterns = [method, ...path.split('/')].filter(Boolean)
    const route = patterns.map(pattern => pattern[0] === ':' ? ':' : pattern).join('/')
    if (this.routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this.routes[route]}`)
    }
    this.routes[route] = path
    const [, ...rest] = patterns
    const root = this.methods[method] ??= new Segment(method)
    root.append(rest, endpoint)
    return this
  }

}

/**
 * exact: "foo", specificity: 9
 * dynam: ":foo", specificity: 8
 * wildcard: "*", specificity: 0
 *
 */
