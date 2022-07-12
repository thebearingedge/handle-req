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

  endpoint?: Endpoint
  dynamicChild?: Slug
  catchAllChild?: Slug
  staticChildren: Slug[] = []

  constructor(private token: string) {}

  append([next, ...rest]: string[], endpoint: Endpoint): void {
    if (next == null) return void (this.endpoint = endpoint)
    if (next === ':') {
      this.dynamicChild ??= new Slug(next)
      this.dynamicChild.append(rest, endpoint)
    } else if (next === '*') {
      this.catchAllChild ??= new Slug(next)
      this.catchAllChild.append(rest, endpoint)
    } else {
      const staticChild = this.staticChildren.find(({ token }) => token === next)
      if (staticChild != null) return staticChild.append(rest, endpoint)
      const newChild = new Slug(next)
      newChild.append(rest, endpoint)
      this.staticChildren.push(newChild)
    }
  }

  match(depth: number, route: string[]): Endpoint | undefined {
    if (this.token !== route[depth] && this.token !== ':') return
    if (depth === route.length - 1) return this.endpoint
    const [staticEndpoint] = this.staticChildren
      .flatMap(staticChild => staticChild.match(depth + 1, route))
      .filter(Boolean)
    return staticEndpoint ??
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

  private _routes: Record<string, string> = Object.create(null)
  private _methods: Record<HTTPMethod, Slug> = Object.create(null)

  private _on<P extends Params = Params>(
    method: HTTPMethod,
    path: string,
    ...handlers: RequestHandlers<P>
  ): this {
    if (!IS_VALID_PATH.test(path)) {
      throw new Error (
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
    const endpoint = new Endpoint(keys, handlers.flat())
    const root = this._methods[method] ??= new Slug(method)
    root.append(tokens, endpoint as Endpoint)
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
    const root = this._methods[req.method as HTTPMethod]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = url.pathname.split('/').filter(Boolean)
    const res = await root.match(0, [req.method, ...route])?.handle(req, url, route)
    return res ?? new Response('', { status: 404 })
  }

}
