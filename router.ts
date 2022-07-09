type PathParams = Record<string, string>

type Next = () => Response | Promise<Response>

type Context<P extends PathParams = PathParams> = {
  req: Request
  params: P
  url: URL
  next: Next
}

type Handler<P extends PathParams = PathParams> = {
  (ctx: Context<P>): Response | Promise<Response>
}

class Endpoint<P extends PathParams = PathParams> {

  pattern: string[]
  handlers: Handler<P>[]

  constructor(pattern: string[], handlers: Handler<P>[]) {
    this.pattern = pattern
    this.handlers = handlers
  }

  async handle(req: Request, url: URL, route: string[]): Promise<Response> {
    const stack = [...this.handlers]
    const matched = route.slice(0, this.pattern.length)
    const params = this.pattern.reduce<P>((params, slug, index) => {
      if (slug.charAt(0) !== ':' && slug !== '*') return params
      const key = slug === '*'
        ? slug
        : slug.slice(1)
      const value = slug === '*'
        ? route.slice(matched.length - 1).join('/')
        : route[index]
      return Object.assign(params, { [key]: value })
    }, Object.create(null))
    return (async function _next(depth: number): Promise<Response> {
      if (depth === stack.length) return new Response('', { status: 501 })
      return await stack[depth]({ req, url, params, next: () => _next(depth + 1) })
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
    const child = this.children.find(({ slug: pattern }) => pattern === next)
    if (child != null) {
      child.append(rest, endpoint)
      return
    }
    const segment = new Segment(next)
    segment.append(rest, endpoint)
    this.children.push(segment)
    this.children.sort(({ slug: a }, { slug: b }) => a > b ? 1 : -1)
  }

  match([curr, ...rest]: string[]): Segment | undefined {
    if (this.slug === '*') return this
    if (this.slug !== curr && this.slug.charAt(0) !== ':') return
    if (rest.length === 0) return this
    return this.children.flatMap(segment => segment.match(rest)).filter(Boolean)[0]
  }

}

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export class Router {

  private _routes: Record<string, string> = Object.create(null)
  private _methods: Record<HTTPMethod, Segment> = Object.create(null)

  private _when<P extends PathParams = PathParams>(
    method: HTTPMethod,
    path: string,
    handlers: Handler<P>[]
  ): this {
    const pattern = path
      .split('/')
      .filter(Boolean)
    const route = [method, ...pattern.map(slug => slug.charAt(0) === ':' ? ':' : slug)].join('/')
    if (this._routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this._routes[route]}`)
    }
    this._routes[route] = path
    const endpoint = new Endpoint(pattern, handlers)
    const root = this._methods[method] ??= new Segment(method)
    root.append(pattern, endpoint as Endpoint<PathParams>)
    return this
  }

  get = <P extends PathParams = PathParams>(path: string, ...handlers: Handler<P>[]) =>
    this._when('GET', path, handlers)

  put = <P extends PathParams = PathParams>(path: string, ...handlers: Handler<P>[]) =>
    this._when('PUT', path, handlers)

  post = <P extends PathParams = PathParams>(path: string, ...handlers: Handler<P>[]) =>
    this._when('POST', path, handlers)

  patch = <P extends PathParams = PathParams>(path: string, ...handlers: Handler<P>[]) =>
    this._when('PATCH', path, handlers)

  delete = <P extends PathParams = PathParams>(path: string, ...handlers: Handler<P>[]) =>
    this._when('DELETE', path, handlers)

  handle = async (req: Request): Promise<Response> => {
    const method = req.method as HTTPMethod
    const root = this._methods[method]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = url.pathname.split('/').filter(Boolean)
    const res = await root.match([method, ...route])?.endpoint?.handle(req, url, route)
    return res ?? new Response('', { status: 404 })
  }

}
