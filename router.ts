type Next = () => Response | Promise<Response>

type Context<Keys extends string = string, Params = { [K in Keys]: string }> = {
  req: Request
  params: Params
  url: URL
  next: Next
}

type Handler<Keys extends string = string, Params = { [K in Keys]: string }> = {
  (ctx: Context<Keys, Params>): Response | Promise<Response>
}

class Endpoint<Keys extends string = string, Params = { [K in Keys]: string }> {

  pattern: string[]
  handlers: Handler<Keys, Params>[]

  constructor(pattern: string[], handlers: Handler<Keys, Params>[]) {
    this.pattern = pattern
    this.handlers = handlers
  }

  async handle(req: Request, url: URL, route: string[]): Promise<Response> {
    const stack = [...this.handlers]
    const params = this.pattern.reduce<Params>((params, slug, index) => {
      if (slug.charAt(0) !== ':') return params
      return Object.assign(params, { [slug.slice(1)]: route[index] })
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

  match([curr, ...rest]: string[]): Segment | undefined {
    if (this.slug !== curr && this.slug.charAt(0) !== ':') return
    if (rest.length === 0) return this
    return this.children.flatMap(segment => segment.match(rest)).filter(Boolean)[0]
  }

}

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export class Router {

  private _routes: Record<string, string> = Object.create(null)
  private _methods: Record<HTTPMethod, Segment> = Object.create(null)

  private _when<Keys extends string = string, Params = { [K in Keys]: string }>(
    method: HTTPMethod,
    path: string,
    handlers: Handler<Keys, Params>[]
  ): this {
    const pattern = path
      .split('/')
      .filter(Boolean)
    const route = [method, ...pattern.map(slug => slug.charAt(0) === ':' ? ':' : slug)].join('/')
    if (this._routes[route] != null) {
      throw new Error(`${method} route conflict: ${path} - ${this._routes[route]}`)
    }
    this._routes[route] = path
    const endpoint = new Endpoint<Keys, Params>(pattern, handlers)
    const root = this._methods[method] ??= new Segment(method)
    root.append(pattern, endpoint as Endpoint<string, {}>)
    return this
  }

  get = <Keys extends string = string, Params = { [K in Keys]: string }>(
    path: string, ...handlers: Handler<Keys, Params>[]
  ) => this._when('GET', path, handlers)

  put = <Keys extends string = string, Params = { [K in Keys]: string }>(
    path: string, ...handlers: Handler<Keys, Params>[]
  ) => this._when('PUT', path, handlers)

  post = <Keys extends string = string, Params = { [K in Keys]: string }>(
    path: string, ...handlers: Handler<Keys, Params>[]
  ) => this._when('POST', path, handlers)

  patch = <Keys extends string = string, Params = { [K in Keys]: string }>(
    path: string, ...handlers: Handler<Keys, Params>[]
  ) => this._when('PATCH', path, handlers)

  delete = <Keys extends string = string, Params = { [K in Keys]: string }>(
    path: string, ...handlers: Handler<Keys, Params>[]
  ) => this._when('DELETE', path, handlers)

  handle = async (req: Request): Promise<Response> => {
    const method = req.method
    const root = this._methods[method as HTTPMethod]
    if (root == null) return new Response('', { status: 404 })
    const url = new URL(req.url)
    const route = url.pathname.split('/').filter(Boolean)
    const res = await root.match([method, ...route])?.endpoint?.handle(req, url, route)
    return res ?? new Response('', { status: 404 })
  }

}
