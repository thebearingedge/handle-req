type NextHandler = () => Response | Promise<Response>

type ParamKeys = [string, number][]

type Params = Record<string, string | string[]>

type Context<P extends Params = Params> = {
  req: Request
  params: P
  url: URL
  next: NextHandler
}

type Handler<P extends Params = Params> = (ctx: Context<P>) => Response | Promise<Response>

class Endpoint<P extends Params = Params> {

  constructor(private keys: ParamKeys, private handlers: Handler<P>[]) { }

  async handle(req: Request, url: URL, route: string[]): Promise<Response> {

    const params = this.keys.reduce((params, [slug, depth]) => {
      if (slug === '*') {
        params[slug] = route.slice(depth)
      } else if (slug in params) {
        if (Array.isArray(params[slug])) {
          params[slug].push(route[depth])
        } else {
          params[slug] = [params[slug], route[depth]]
        }
      } else {
        params[slug] = route[depth]
      }
      return params
    }, Object.create(null))

    const stack = this.handlers

    return (async function _next(depth: number = 0): Promise<Response> {
      return await stack[depth]({ req, url, params, next: () => _next(depth + 1) })
    })()
  }

}

class Node<P extends Params = Params> {

  endpoint: Endpoint<P> | null = null
  dynamicChild: Node | null = null
  catchAllChild: Node | null = null
  staticChildren: Record<string, Node> | null = null

  constructor(public token: string) { }
}

type RequestHandlers<P extends Params = Params> =
  | [Handler<P>, ...Handler<P>[]]
  | [[Handler<P>, ...Handler<P>[]]]

type Route<R extends Router = Router> = <P extends Params = Params>(
  path: string,
  ...handlers: RequestHandlers<P>
) => R

const IS_VALID_PATH = /^\/((?::?[\w\d.-~@]+)(?:\/:?[\w\d_.-~@]+)*(?:\/\*)?\/?)?$/

export class Router extends Function {

  protected _routes: Record<string, string> = Object.create(null)
  protected _methods: Record<string, Node> = Object.create(null)

  on<P extends Params = Params>(
    method: string,
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

    const keys = pattern.reduce<ParamKeys>((keys, slug, index) => {
      if (slug === '*') keys.push([slug, index])
      if (slug.startsWith(':')) keys.push([slug.slice(1), index])
      return keys
    }, [])

    let node: Node<P> = this._methods[method] ??= new Node('/')

    for (let t = 0; t < tokens.length; t++) {
      let token = tokens[t]
      if (token === ':') {
        node = node.dynamicChild ??= new Node(token)
      } else if (token === '*') {
        node = node.catchAllChild ??= new Node(token)
      } else {
        node.staticChildren ??= Object.create(null)
        // @ts-expect-error i just added staticChildren 🤷‍♀️
        node = node.staticChildren[token] ??= new Node(token)
      }
    }

    node.endpoint = new Endpoint(keys, handlers.flat())

    return this
  }

  match(root: Node, route: string[]): Endpoint | null {

    const stack: [Node, number][] = [[root, 0]]

    while (stack.length !== 0) {
      const [node, depth] = stack.pop() as [Node, number]
      if (node.token === '*') return node.endpoint
      const next = depth + 1
      if (next === route.length) return node.endpoint
      if (node.catchAllChild != null) stack.push([node.catchAllChild, next])
      if (node.dynamicChild != null) stack.push([node.dynamicChild, next])
      if (node.staticChildren?.[route[next]] != null) {
        stack.push([node.staticChildren[route[next]], next])
      }
    }

    return null
  }

  get: Route<typeof this> = (path, ...handlers) => this.on('GET', path, ...handlers)
  put: Route<typeof this> = (path, ...handlers) => this.on('PUT', path, ...handlers)
  post: Route<typeof this> = (path, ...handlers) => this.on('POST', path, ...handlers)
  head: Route<typeof this> = (path, ...handlers) => this.on('HEAD', path, ...handlers)
  patch: Route<typeof this> = (path, ...handlers) => this.on('PATCH', path, ...handlers)
  delete: Route<typeof this> = (path, ...handlers) => this.on('DELETE', path, ...handlers)
  options: Route<typeof this> = (path, ...handlers) => this.on('OPTIONS', path, ...handlers)

  fetch = async (req: Request): Promise<Response> => {
    const root = this._methods[req.method]
    if (root == null) return new Response(null, { status: 404 })
    const url = new URL(req.url)
    const route = ['/', ...url.pathname.split('/').filter(Boolean)]
    const endpoint = this.match(root, route)
    if (endpoint == null) return new Response(null, { status: 404 })
    return await endpoint.handle(req, url, route.slice(1)) ?? new Response(null, { status: 501 })
  }

}
