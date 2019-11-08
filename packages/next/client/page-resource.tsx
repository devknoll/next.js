import React from 'react'

type PageEntry =
  | { status: 'pending'; promise: Promise<any>; resolve: (result: any) => void }
  | { status: 'finished'; result: any }

type Cache = Map<string, PageEntry>
type Loader = (name: string, gen: () => any) => void
type ComponentFactory = (name: string) => React.ComponentType

export function usePageLoader(): [Loader, ComponentFactory] {
  const cache = React.useMemo(() => new Map<string, PageEntry>(), [])
  const loader: Loader = React.useMemo(
    () => (name, gen) => {
      const script = cache.get(name)
      if (script && script.status === 'pending') {
        script.resolve(gen())
      } else {
        cache.set(name, { status: 'finished', result: gen() })
      }
    },
    [cache]
  )

  const factory: ComponentFactory = React.useMemo(
    () => name => props => {
      const mod = useCachedScript(name, cache)
      const Component = mod.default || mod

      return <Component {...props} />
    },
    []
  )

  return [loader, factory]
}

function useCachedScript(name: string, cache: Cache) {
  let script = cache.get(name)

  if (!script) {
    let resolve = (result: any) => {}
    const promise = new Promise(r => {
      resolve = (result: any) => {
        cache.set(name, { status: 'finished', result })
        r()
      }
    })
    script = { status: 'pending', promise, resolve }
    cache.set(name, script)
  }

  if (script.status === 'pending') {
    throw script.promise
  }
  return script.result
}
