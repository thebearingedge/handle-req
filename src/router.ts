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
    const params = Object.keys(this.keys).map(Number).reduce((params, position) => {
      const key = this.keys[position]
      if (key === '*') {
        params[key] = route.slice(position).join('/')
        return params
      }
      if (key in params) {
        if (Array.isArray(params[key])) {
          params[key].push(route[position])
          return params
        } else {
          params[key] = [params[key], route[position]]
        }
      } else {
        params[key] = route[position]
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

class Segment {

  slug: string
  endpoint?: Endpoint
  children: Segment[] = []

  constructor(slug: string) {
    this.slug = slug
  }

  append([next, ...rest]: string[], endpoint: Endpoint): void {
    if (next == null) {
      this.endpoint = endpoint
      return
    }
    const child = this.children.find(({ slug }) => slug === next)
    if (child != null) {
      child.append(rest, endpoint)
      return
    }
    const segment = new Segment(next)
    segment.append(rest, endpoint)
    this.children.push(segment)
    this.children.sort(({ slug: a }, { slug: b }) => a < b ? 1 : -1)
  }

  match(position: number, route: string[]): Segment | undefined {
    if (this.slug === '*') return this
    if (this.slug !== route[position] && this.slug.charAt(0) !== ':') return
    if (position === route.length - 1) return this
    return this.children.flatMap(child => child.match(position + 1, route)).filter(Boolean)[0]
  }

}

type HTTPMethod = 'GET' | 'PUT' | 'POST' | 'HEAD' | 'PATCH' | 'DELETE' |  'OPTIONS'

type RequestHandlers<P extends Params = Params> = Handler<P>[] | [Handler<P>[]]

type Route<R extends Router = Router> =
  <P extends Params = Params>(path: string, ...handlers: RequestHandlers<P>) => R

export class Router {

  private _routes: Record<string, string> = Object.create(null)
  private _methods: Record<HTTPMethod, Segment> = Object.create(null)

  private _on<P extends Params = Params>(
    method: HTTPMethod,
    path: string,
    ...handlers: RequestHandlers<P>
  ): this {
    const slugs = path.split('/').filter(Boolean)
    const pattern = slugs.map(slug => slug.startsWith(':') ? ':' : slug)
    const route = [method, ...pattern].join('/')
    if (this._routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this._routes[route]}`)
    }
    this._routes[route] = path
    const keys = slugs.reduce((keys, slug, index) => {
      if (slug === '*') keys[index] = slug
      if (slug.startsWith(':')) keys[index] = slug.slice(1)
      return keys
    }, Object.create(null))
    const endpoint = new Endpoint(keys, handlers.flat())
    const root = this._methods[method] ??= new Segment(method)
    root.append(pattern, endpoint as Endpoint)
    return this
  }

  get: Route<typeof this> = (path, ...handlers) => this._on('GET', path, ...handlers)
  put: Route<typeof this> = (path, ...handlers) => this._on('PUT', path, ...handlers)
  post: Route<typeof this> = (path, ...handlers) => this._on('POST', path, ...handlers)
  head: Route<typeof this> = (path, ...handlers) => this._on('HEAD', path, ...handlers)
  patch: Route<typeof this> = (path, ...handlers) => this._on('PATCH', path, ...handlers)
  delete: Route<typeof this> = (path, ...handlers) => this._on('DELETE', path, ...handlers)
  options: Route<typeof this> = (path, ...handlers) => this._on('OPTIONS', path, ...handlers)

  async fetch(req: Request): Promise<Response> {
    const root = this._methods[req.method as HTTPMethod]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = url.pathname.split('/').filter(Boolean)
    const res = await root.match(0, [req.method, ...route])?.endpoint?.handle(req, url, route)
    return res ?? new Response('', { status: 404 })
  }

}
