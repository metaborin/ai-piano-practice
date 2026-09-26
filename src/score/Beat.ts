import type { BeatFraction } from './ScoreModel'

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  while (b) { const rest = a % b; a = b; b = rest }
  return a || 1n
}

/** Exact arithmetic internally; convert to Number only at the external beats boundary. */
export class Beat {
  readonly n: bigint
  readonly d: bigint
  constructor(n: bigint, d = 1n) {
    if (d <= 0n) throw new Error('拍の分母が不正です。')
    const common = gcd(n, d)
    this.n = n / common; this.d = d / common
    if (this.n.toString().length > 100 || this.d.toString().length > 100) throw new Error('拍の精度が解析上限を超えています。')
  }
  static zero = () => new Beat(0n)
  static decimal(value: string): Beat {
    if (value.length > 32 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error('拍の数値が不正です。')
    const negative = value.startsWith('-')
    const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.')
    return new Beat((negative ? -1n : 1n) * BigInt((integer || '0') + fraction), 10n ** BigInt(fraction.length))
  }
  static from(value: BeatFraction) { return new Beat(BigInt(value.numerator), BigInt(value.denominator)) }
  add(other: Beat) { return new Beat(this.n * other.d + other.n * this.d, this.d * other.d) }
  subtract(other: Beat) { return new Beat(this.n * other.d - other.n * this.d, this.d * other.d) }
  divide(other: Beat) {
    if (other.n <= 0n) throw new Error('divisionsは正数である必要があります。')
    return new Beat(this.n * other.d, this.d * other.n)
  }
  compare(other: Beat) { const value = this.n * other.d - other.n * this.d; return value < 0n ? -1 : value > 0n ? 1 : 0 }
  get key() { return this.n + '/' + this.d }
  get beats() { return Number(this.n) / Number(this.d) }
  toJSON(): BeatFraction { return { numerator: String(this.n), denominator: String(this.d) } }
}
