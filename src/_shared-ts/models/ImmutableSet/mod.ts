// type DerivedSet = extends ImmutableSet<Type>

export default class ImmutableSet<Type> {
  protected _data: Map<string, Type>

  constructor() {
    this._data = new Map<string, Type>()
  }

  add(value: Type): this {
    const set = new (this.constructor as any)()
    set['_data'] = new Map(this._data)
    set['_data'].set(String(value), value)
    return set
  }

  delete(value: Type): this {
    const key = String(value)
    const obj = this['_data'].get(key)
    if (!obj) return this // nothing to remove

    const set = new (this.constructor as any)()
    set['_data'] = new Map(this._data)
    set['_data'].delete(key)

    return set
  }

  // key comparison only
  // order doesn't matter
  equals(otherSet: ImmutableSet<Type>): boolean {
    if (this.size !== otherSet.size) return false
    const thisKeys = Array.from(this._data.keys())
    const otherKeys = Array.from(otherSet['_data'].keys())

    // if order mattered
    // return thisKeys.every((item, i) => item === otherKeys[i])
    return thisKeys.every((item) => otherKeys.includes(item))
  }

  has(value: Type): boolean {
    return this._data.has(String(value))
  }

  isSubsetOf(superSet: ImmutableSet<Type>): boolean {
    for (const item of this) {
      if (!superSet.has(item)) return false
    }

    return true
  }

  isSupersetOf(subSet: ImmutableSet<Type>): boolean {
    for (const item of subSet) {
      if (!this.has(item)) return false
    }

    return true
  }

  // preserves order
  replace(oldValue: Type, newValue: Type): this {
    const oldKey = String(oldValue)
    if (!this._data.has(oldKey)) return this

    const set = new (this.constructor as any)()

    const entries = Array.from(this['_data'].entries())
    let replaceIndex = -1

    for (let i = 0; i < entries.length; ++i) {
      const [key] = entries[i]
      if (oldKey === key) {
        replaceIndex = i
        break
      }
    }

    if (replaceIndex === -1) throw new Error('TagSet.replace: should have been able to find replace key.')

    entries[replaceIndex] = [String(newValue), newValue]
    set['_data'] = new Map(entries)

    return set
  }

  toString(): string {
    return '<SUPERCLASS - you likely dont want this>'
  }

  // TODO: need to fix return type
  union(otherSet: ImmutableSet<Type>): this {
    const arr1 = Array.from(this)
    const arr2 = Array.from(otherSet)
    const both = [...arr1, ...arr2]
    return ImmutableSet._fromArray(this.constructor as any, both)
  }

  [Symbol.iterator]() {
    return this._data.values()
  }

  get size(): number {
    return this._data.size
  }

  // not meant to be used directly
  // some weird overloading shit happens if the
  // the derived class has the same name
  // for a static method
  static _fromArray<Type, A extends ImmutableSet<Type>>(c: new () => A, array: Type[]): A {
    const map = new Map<string, Type>()

    array.forEach((val) => {
      map.set(String(val), val)
    })

    const set = new c()
    set['_data'] = map

    return set
  }
}
