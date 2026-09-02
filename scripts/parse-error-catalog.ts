export type CatalogDescriptor = readonly [
  status: number,
  message: string,
  safeDetails: ReadonlyArray<string>,
  variants: Readonly<Record<string, readonly [message: string, status: number]>>,
  retryClass: RetryClass,
]

export type ErrorCatalog = Readonly<Record<string, CatalogDescriptor>>
export type RetryClass =
  | "after_delay"
  | "after_user_action"
  | "bounded_retry"
  | "dependency_retry"
  | "never"
  | "user_retry"

const retryClasses = new Set<RetryClass>([
  "after_delay",
  "after_user_action",
  "bounded_retry",
  "dependency_retry",
  "never",
  "user_retry",
])

class PythonLiteralParser {
  private index = 0

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value()
    this.space()
    if (this.index !== this.source.length) throw this.error("Unexpected trailing input")
    return value
  }

  private value(): unknown {
    this.space()
    const current = this.source[this.index]
    if (current === "'" || current === '"') return this.adjacentStrings()
    if (current === "[") return this.array()
    if (current === "{") return this.object()
    if (current === "-" || (current !== undefined && /\d/.test(current))) return this.number()
    for (const [token, value] of [
      ["None", null],
      ["True", true],
      ["False", false],
    ] as const) {
      if (this.source.startsWith(token, this.index)) {
        this.index += token.length
        return value
      }
    }
    throw this.error("Unsupported Python literal")
  }

  private adjacentStrings(): string {
    let value = ""
    while (true) {
      this.space()
      const quote = this.source[this.index]
      if (quote !== "'" && quote !== '"') return value
      value += this.string(quote)
    }
  }

  private string(quote: "'" | '"'): string {
    this.index++
    let value = ""
    while (this.index < this.source.length) {
      const current = this.source[this.index++]
      if (current === quote) return value
      if (current === "\n" || current === "\r" || current === undefined) throw this.error("Unterminated string")
      if (current !== "\\") {
        value += current
        continue
      }
      const escaped = this.source[this.index++]
      const simple: Readonly<Record<string, string>> = {
        "\\": "\\",
        "'": "'",
        '"': '"',
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        v: "\v",
        a: "\x07",
      }
      if (escaped !== undefined && escaped in simple) {
        value += simple[escaped]
        continue
      }
      const widths: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 }
      const width = escaped === undefined ? undefined : widths[escaped]
      if (width === undefined) throw this.error("Unsupported string escape")
      const encoded = this.source.slice(this.index, this.index + width)
      if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(encoded)) throw this.error("Invalid string escape")
      this.index += width
      value += String.fromCodePoint(Number.parseInt(encoded, 16))
    }
    throw this.error("Unterminated string")
  }

  private array(): ReadonlyArray<unknown> {
    this.index++
    const values: unknown[] = []
    while (true) {
      this.space()
      if (this.source[this.index] === "]") {
        this.index++
        return values
      }
      values.push(this.value())
      this.space()
      if (this.source[this.index] === "]") continue
      if (this.source[this.index] !== ",") throw this.error("Expected array separator")
      this.index++
    }
  }

  private object(): Readonly<Record<string, unknown>> {
    this.index++
    const value: Record<string, unknown> = Object.create(null)
    while (true) {
      this.space()
      if (this.source[this.index] === "}") {
        this.index++
        return value
      }
      const key = this.value()
      if (typeof key !== "string") throw this.error("Expected string object key")
      this.space()
      if (this.source[this.index] !== ":") throw this.error("Expected object colon")
      this.index++
      if (Object.hasOwn(value, key)) throw this.error("Duplicate object key")
      value[key] = this.value()
      this.space()
      if (this.source[this.index] === "}") continue
      if (this.source[this.index] !== ",") throw this.error("Expected object separator")
      this.index++
    }
  }

  private number(): number {
    const match = /^-?\d+/.exec(this.source.slice(this.index))
    if (match === null) throw this.error("Invalid number")
    this.index += match[0].length
    const value = Number(match[0])
    if (!Number.isSafeInteger(value)) throw this.error("Integer is outside the safe range")
    return value
  }

  private space(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index++
  }

  private error(message: string): Error {
    return new Error(`${message} at Python catalog offset ${this.index}`)
  }
}

const object = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value as Readonly<Record<string, unknown>>
}

export const parsePythonErrorCatalog = (source: string): ErrorCatalog => {
  const assignment = source.indexOf("ERROR_CATALOG_DATA")
  const tuple = assignment < 0 ? -1 : source.indexOf("tuple(", assignment)
  if (tuple < 0) throw new Error("Python error catalog assignment is missing")
  const close = source.lastIndexOf(")")
  if (close <= tuple + 6 || source.slice(close + 1).trim() !== "") {
    throw new Error("Python error catalog tuple is malformed")
  }
  const rows = new PythonLiteralParser(source.slice(tuple + 6, close)).parse()
  if (!Array.isArray(rows)) throw new Error("Python error catalog must contain a list")

  const catalog: Record<string, CatalogDescriptor> = {}
  for (const [index, candidate] of rows.entries()) {
    const row = object(candidate, `error descriptor ${index}`)
    const code = row.code
    const status = row.http_status
    const message = row.message
    const safe = row.safe_detail_fields
    const retryClass = row.retry_class
    const rawVariants = object(row.variants, `variants for ${String(code)}`)
    if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(code) || Object.hasOwn(catalog, code)) {
      throw new Error(`Invalid or duplicate error code at descriptor ${index}`)
    }
    if (
      !Number.isInteger(status) ||
      typeof message !== "string" ||
      !Array.isArray(safe) ||
      !safe.every((v) => typeof v === "string") ||
      typeof retryClass !== "string" ||
      !retryClasses.has(retryClass as RetryClass)
    ) {
      throw new Error(`Invalid canonical error descriptor for ${code}`)
    }
    const variants: Record<string, readonly [string, number]> = {}
    for (const [name, candidateVariant] of Object.entries(rawVariants)) {
      const variant = object(candidateVariant, `variant ${code}/${name}`)
      if (typeof variant.message !== "string" || !Number.isInteger(variant.http_status)) {
        throw new Error(`Invalid canonical error variant ${code}/${name}`)
      }
      Object.defineProperty(variants, name, {
        value: [variant.message, variant.http_status as number],
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    catalog[code] = [status as number, message, safe, variants, retryClass as RetryClass]
  }
  return catalog
}
