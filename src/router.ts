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

export class Router {

  private _routes: Record<string, string> = Object.create(null)
  private _methods: Record<HTTPMethod, Segment> = Object.create(null)

  private _when<P extends Params = Params>(
    method: HTTPMethod,
    path: string,
    handlers: Handler<P>[]
  ): this {
    const pathArray = path.split('/').filter(Boolean)
    const pathPattern = pathArray.map(slug => slug.startsWith(':') ? ':' : slug)
    const route = [method, ...pathPattern].join('/')
    if (this._routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this._routes[route]}`)
    }
    this._routes[route] = path
    const paramKeys = pathArray.reduce((keys, slug, index) => {
      if (slug === '*') keys[index] = slug
      if (slug.startsWith(':')) keys[index] = slug.slice(1)
      return keys
    }, Object.create(null))
    const endpoint = new Endpoint(paramKeys, handlers)
    const root = this._methods[method] ??= new Segment(method)
    root.append(pathPattern, endpoint as Endpoint<{}>)
    return this
  }

  get = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('GET', path, handlers.flat())

  put = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('PUT', path, handlers.flat())

  post = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('POST', path, handlers.flat())

  head = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('HEAD', path, handlers.flat())

  patch = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('PATCH', path, handlers.flat())

  delete = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('DELETE', path, handlers.flat())

  options = <P extends Params = Params>(path: string, ...handlers: Handler<P>[] | [Handler<P>[]]) =>
    this._when('OPTIONS', path, handlers.flat())

  async handle(req: Request): Promise<Response> {
    const root = this._methods[req.method as HTTPMethod]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = url.pathname.split('/').filter(Boolean)
    const res = await root.match(0, [req.method, ...route])?.endpoint?.handle(req, url, route)
    return res ?? new Response('', { status: 404 })
  }

}
