type JSONValue =
  | number
  | boolean
  | string
  | null
  | Array<JSONValue>
  | { [key: string]: JSONValue }
  | { toJSON(): JSONValue }

export class HotRequest extends Request {

}

export class HotResponse extends Response {

  static json(data: JSONValue): HotResponse {
    return new this(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8'
      }
    })
  }

}
