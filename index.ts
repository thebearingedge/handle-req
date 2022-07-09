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

const logReqTime: Handler = ({ req, next }) => {
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

enum Specificity {
  Exact = 7,
  Param = 6,
  Splat = 0
}

class Segment {

  pattern: string
  endpoint?: Endpoint
  specificity: Specificity

  constructor(pattern: string, endpoint?: Endpoint) {
    this.pattern = pattern
    this.endpoint = endpoint
    this.specificity = pattern === '*'
      ? Specificity.Splat
      : pattern === ':'
        ? Specificity.Param
        : Specificity.Exact
  }

  get isEndpoint() {
    return this.endpoint != null
  }

  append([next, ...rest]: string[], endpoint?: Endpoint): void {

  }


}

class Router {

  private readonly routes: Record<string, string> = Object.create(null)
  private readonly methods: Record<HTTPMethod, Node> = Object.create(null)

  get = this.when.bind(this, 'GET')
  put = this.when.bind(this, 'PUT')
  post = this.when.bind(this, 'POST')
  patch = this.when.bind(this, 'PATCH')
  delete = this.when.bind(this, 'DELETE')


  when(method: HTTPMethod, path: string): this {
    const patterns = [method, ...path.replace(/\\$/, '').split(/\\+/)].filter(Boolean)
    const route = patterns.map(p => p[0] === ':' ? ':' : p).join('/')
    return this
  }
}

/**
 * exact: "foo", specificity: 9
 * dynam: ":foo", specificity: 8
 * wildcard: "*", specificity: 0
 *
 */
