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
        return params
      }
      if (key in params) {
        if (Array.isArray(params[key])) {
          params[key].push(route[depth])
          return params
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

class Slug {

  private endpoint?: Endpoint
  private dynamicChild?: Slug
  private catchAllChild?: Slug
  private staticChildren: Slug[] = []

  constructor(private token: string) {}

  append(depth: number, tokens: string[], endpoint: Endpoint): void {
    const token = tokens[depth]
    if (token == null) return void (this.endpoint = endpoint)
    if (token === ':') {
      this.dynamicChild ??= new Slug(token)
      this.dynamicChild.append(depth + 1, tokens, endpoint)
    } else if (token === '*') {
      this.catchAllChild ??= new Slug(token)
      this.catchAllChild.append(depth + 1, tokens, endpoint)
    } else {
      const child = this.staticChildren.find(child => token === child.token)
      if (child != null) return child.append(depth + 1, tokens, endpoint)
      const newChild = new Slug(token)
      newChild.append(depth + 1, tokens, endpoint)
      this.staticChildren.push(newChild)
    }
  }

  match(depth: number, route: string[]): Endpoint | undefined {
    if (this.token !== route[depth] && this.token !== ':') return
    if (depth + 1 === route.length) return this.endpoint
    const [matched] = this.staticChildren
      .flatMap(child => child.match(depth + 1, route))
      .filter(Boolean)
    return matched ??
           this.dynamicChild?.match(depth + 1, route) ??
           this.catchAllChild?.endpoint
  }

}

type HTTPMethod = 'GET' | 'PUT' | 'POST' | 'HEAD' | 'PATCH' | 'DELETE' | 'OPTIONS'

type RequestHandlers<P extends Params = Params> =
  | [Handler<P>, ...Handler<P>[]]
  | [[Handler<P>, ...Handler<P>[]]]

type Route<R extends Router = Router> =
  <P extends Params = Params>(path: string, ...handlers: RequestHandlers<P>) => R

const IS_VALID_PATH = /^\/((?::?[\w\d.-]+)(?:\/:?[\w\d_.-]+)*(?:\/\*)?\/?)?$/

export class Router {

  private routes: Record<string, string> = Object.create(null)
  private methods: Record<HTTPMethod, Slug> = Object.create(null)

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
    if (this.routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this.routes[route]}`)
    }
    this.routes[route] = path
    const keys = pattern.reduce((keys, slug, index) => {
      if (slug === '*') keys[index] = slug
      if (slug.startsWith(':')) keys[index] = slug.slice(1)
      return keys
    }, Object.create(null))
    const endpoint = new Endpoint(keys, handlers.flat())
    const root = this.methods[method] ??= new Slug(method)
    root.append(0, tokens, endpoint as Endpoint)
    return this
  }

  get: Route<typeof this> = (path, ...handlers) => this._on('GET', path, ...handlers)
  put: Route<typeof this> = (path, ...handlers) => this._on('PUT', path, ...handlers)
  post: Route<typeof this> = (path, ...handlers) => this._on('POST', path, ...handlers)
  head: Route<typeof this> = (path, ...handlers) => this._on('HEAD', path, ...handlers)
  patch: Route<typeof this> = (path, ...handlers) => this._on('PATCH', path, ...handlers)
  delete: Route<typeof this> = (path, ...handlers) => this._on('DELETE', path, ...handlers)
  options: Route<typeof this> = (path, ...handlers) => this._on('OPTIONS', path, ...handlers)

  fetch = async (req: Request): Promise<Response> => {
    const root = this.methods[req.method as HTTPMethod]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = url.pathname.split('/').filter(Boolean)
    const res = await root.match(0, [req.method, ...route])?.handle(req, url, route)
    return res ?? new Response('', { status: 404 })
  }

}
