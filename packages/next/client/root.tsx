import React from 'react'

import { createRouter, makePublicRouterInstance } from '../client/router'
import { RouterContext } from '../next-server/lib/router-context'
import { usePageLoader } from './page-resource'
import { getURL } from '../next-server/lib/utils'

export type Props = {}

export type ImperativeHandle = {}

export default React.forwardRef(function Root(props: Props, ref) {
  const data = React.useMemo(() => {
    const elem = document.getElementById('__NEXT_DATA__')
    return elem && elem.textContent ? JSON.parse(elem.textContent) : {}
  }, [])

  const asPath = React.useMemo(() => getURL(), [])

  const { page, props: initialProps, query } = data

  const [pageLoader, lazyPage] = usePageLoader()

  const App = React.useMemo(() => lazyPage('/_app'), [lazyPage])
  const Component = React.useMemo(() => lazyPage(page), [page])

  const router = React.useMemo(
    () =>
      createRouter(page, query, asPath, {
        initialProps: props,
        pageLoader,
        App,
        Component,
        wrapApp: props => null,
        err: undefined,
        subscription: ({ Component, props, err }, App) => {},
      }),
    []
  )

  React.useImperativeHandle(ref, () => ({
    page: pageLoader,
  }))

  return (
    <React.Suspense fallback={null}>
      <RouterContext.Provider value={makePublicRouterInstance(router)}>
        <App router={router} Component={Component} {...initialProps} />
      </RouterContext.Provider>
    </React.Suspense>
  )
})
