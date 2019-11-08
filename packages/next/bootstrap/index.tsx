import React from 'react'
import ReactDOM from 'react-dom'

// Polyfill Promise globally
// This is needed because Webpack's dynamic loading(common chunks) code
// depends on Promise.
// So, we need to polyfill it.
// See: https://webpack.js.org/guides/code-splitting/#dynamic-imports
// @ts-ignore
if (!window.Promise) {
  // @ts-ignore
  window.Promise = Promise
}

type Options = import('../client/root').Props
type RootRef = import('../client/root').ImperativeHandle
type ActFn = (ref: RootRef) => void

export type Instance = {
  push: (fn: ActFn) => void
  version: string
}

export default function bootstrap(opts: Options, prev: unknown) {
  const domEl = document.getElementById('__next')
  if (!domEl) {
    throw new Error('Could not find root element')
  }

  const rootOpts = { hydrate: true }
  const root =
    process.env.__NEXT_REACT_MODE === 'concurrent'
      ? ReactDOM.createRoot(domEl, rootOpts)
      : ReactDOM.createBlockingRoot(domEl, rootOpts)

  const queue: ActFn[] = Array.isArray(prev) ? prev : []
  const inst: Instance = {
    push: fn => {
      queue.push(fn)
    },
    version: process.env.__NEXT_VERSION!,
  }

  const Root = React.lazy(() => import('../client/root')) as any

  root.render(
    <React.Suspense fallback={null}>
      <Root
        ref={(ref: RootRef) => {
          inst.push = fn => fn(ref)
          queue.forEach(inst.push)
          queue.length = 0
        }}
        {...opts}
      />
    </React.Suspense>,
    () => {}
  )

  return inst
}
