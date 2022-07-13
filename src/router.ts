type NextHandler = () => Response | Promise<Response>

type ParamKeys = Record<string, string>

type Params = Record<string, string | string[]>

type Context<P extends Params = Params> = {
  req: Request
  params: P
  url: URL
  next: NextHandler
}

type Handler<P extends Params = Params> = (ctx: Context<P>) => Response | Promise<Response>

class Endpoint<P extends Params = Params> {

  constructor(private keys: ParamKeys, private handlers: Handler<P>[]) {}

  async handle(req: Request, url: URL, route: string[]): Promise<Response> {

    const params = Object.keys(this.keys).map(Number).reduce((params, depth) => {
      const key = this.keys[depth]
      if (key === '*') {
        params[key] = route.slice(depth).join('/')
      } else if (key in params) {
        if (Array.isArray(params[key])) {
          params[key].push(route[depth])
        } else {
          params[key] = [params[key], route[depth]]
        }
      } else {
        params[key] = route[depth]
      }
      return params
    }, Object.create(null))

    const stack = this.handlers

    return (async function _next(depth: number): Promise<Response> {
      const res = await stack[depth]({ req, url, params, next: () => _next(depth + 1) })
      return res ?? new Response('', { status: 501 })
    })(0)
  }

}

type Node<P extends Params = Params> = {
  token: string
  endpoint?: Endpoint<P>
  dynamicChild?: Node
  catchAllChild?: Node
  staticChildren?: Record<string, Node>
}

type HTTPMethod = 'GET' | 'PUT' | 'POST' | 'HEAD' | 'PATCH' | 'DELETE' | 'OPTIONS'

type RequestHandlers<P extends Params = Params> =
  | [Handler<P>, ...Handler<P>[]]
  | [[Handler<P>, ...Handler<P>[]]]

type Route<R extends Router = Router> = <P extends Params = Params>(
  path: string,
  ...handlers: RequestHandlers<P>
) => R

const IS_VALID_PATH = /^\/((?::?[\w\d.-]+)(?:\/:?[\w\d_.-]+)*(?:\/\*)?\/?)?$/

export class Router {

  private _routes: Record<string, string> = Object.create(null)
  private _methods: Record<HTTPMethod, Node> = Object.create(null)

  private _on<P extends Params = Params>(
    method: HTTPMethod,
    path: string,
    ...handlers: RequestHandlers<P>
  ): this {

    if (!IS_VALID_PATH.test(path)) {
      throw new Error(
        `invalid route ${path} - may only contain /static, /:dynamic, and end with catch-all /*`
      )
    }

    const pattern = path.split('/').filter(Boolean)
    const tokens = pattern.map(slug => slug.startsWith(':') ? ':' : slug)
    const route = [method, ...tokens].join('/')

    if (this._routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this._routes[route]}`)
    }

    this._routes[route] = path

    const keys = pattern.reduce((keys, slug, index) => {
      if (slug === '*') keys[index] = slug
      if (slug.startsWith(':')) keys[index] = slug.slice(1)
      return keys
    }, Object.create(null))

    let node: Node<P> = this._methods[method] ??= { token: '/' }

    for (let t = 0; t < tokens.length; t++) {
      let token = tokens[t]
      if (token === ':') {
        node = node.dynamicChild ??= { token }
      } else if (token === '*') {
        node = node.catchAllChild ??= { token }
      } else {
        node.staticChildren ??= Object.create(null)
        // @ts-expect-error i just added staticChildren 🤷‍♀️
        node = node.staticChildren[token] ??= { token }
      }
    }

    node.endpoint = new Endpoint(keys, handlers.flat())

    return this
  }

  private _match(root: Node, route: string[]): Endpoint | undefined {

    const stack: [Node, number][] = [[root, 0]]

    while (stack.length !== 0) {
      const [node, depth] = stack.pop() as [Node, number]
      if (node.token === '*') return node.endpoint
      const next = depth + 1
      if (next === route.length) return node.endpoint
      if (node.catchAllChild != null) {
        stack.push([node.catchAllChild, next])
      }
      if (node.dynamicChild != null) {
        stack.push([node.dynamicChild, next])
      }
      if (node.staticChildren?.[route[next]] != null) {
        stack.push([node.staticChildren[route[next]], next])
      }
    }

  }

  get: Route<typeof this> = (path, ...handlers) => this._on('GET', path, ...handlers)
  put: Route<typeof this> = (path, ...handlers) => this._on('PUT', path, ...handlers)
  post: Route<typeof this> = (path, ...handlers) => this._on('POST', path, ...handlers)
  head: Route<typeof this> = (path, ...handlers) => this._on('HEAD', path, ...handlers)
  patch: Route<typeof this> = (path, ...handlers) => this._on('PATCH', path, ...handlers)
  delete: Route<typeof this> = (path, ...handlers) => this._on('DELETE', path, ...handlers)
  options: Route<typeof this> = (path, ...handlers) => this._on('OPTIONS', path, ...handlers)

  fetch = async (req: Request): Promise<Response> => {
    const root = this._methods[req.method as HTTPMethod]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = ['/', ...url.pathname.split('/').filter(Boolean)]
    const res = await this._match(root, route)?.handle(req, url, route.slice(1))
    return res ?? new Response('', { status: 404 })
  }

}
