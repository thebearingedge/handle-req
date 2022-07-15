import { HotResponse } from "./req-res"

export const ok = (body?: any) => body == null ? new HotResponse() : new HotResponse(body)

export const get = (url: string) => new Request(`test://${url}`)
