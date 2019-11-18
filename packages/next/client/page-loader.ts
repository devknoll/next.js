/* global document, window */
import mitt, { MittEmitter } from '../next-server/lib/mitt'

declare global {
  interface Window {
    __BUILD_MANIFEST?: any
    __BUILD_MANIFEST_CB?: any
  }
}

type NormalizedRoute = string & { __normalizedRoute: void }

const hasPreload = (() => {
  try {
    return document.createElement('link').relList.supports('preload')
  } catch {
    return false
  }
})()

function preloadScript(url: string) {
  const link = document.createElement('link')
  link.rel = 'preload'
  // @ts-ignore
  link.crossOrigin = process.crossOrigin
  link.href = encodeURI(url)
  link.as = 'script'
  document.head.appendChild(link)
}

export default class PageLoader {
  readonly buildId: string
  readonly assetPrefix: string
  readonly pageCache: Map<NormalizedRoute, any>
  readonly pageRegisterEvents: MittEmitter
  readonly loadingRoutes: Map<NormalizedRoute, any>
  readonly promisedBuildManifest?: Promise<{ [key: string]: string[] }>

  constructor(buildId: string, assetPrefix: string) {
    this.buildId = buildId
    this.assetPrefix = assetPrefix

    this.pageCache = new Map()
    this.pageRegisterEvents = mitt()
    this.loadingRoutes = new Map()

    if (process.env.__NEXT_GRANULAR_CHUNKS) {
      this.promisedBuildManifest = new Promise(resolve => {
        if (window.__BUILD_MANIFEST) {
          resolve(window.__BUILD_MANIFEST)
        } else {
          window.__BUILD_MANIFEST_CB = () => {
            resolve(window.__BUILD_MANIFEST)
          }
        }
      })
    }
  }

  // Returns a promise for the dependencies for a particular route
  getDependencies(route: NormalizedRoute) {
    return this.promisedBuildManifest
      ? this.promisedBuildManifest.then(
          man => (man[route] && man[route].map(url => `/_next/${url}`)) || []
        )
      : Promise.resolve([])
  }

  normalizeRoute(route: string): NormalizedRoute {
    if (route[0] !== '/') {
      throw new Error(`Route name should start with a "/", got "${route}"`)
    }
    route = route.replace(/\/index$/, '/')

    return route === '/'
      ? (route as NormalizedRoute)
      : (route.replace(/\/$/, '') as NormalizedRoute)
  }

  async loadPage(route: string) {
    const v = await this.loadPageScript(route)
    return v.page
  }

  loadPageScript(maybeRoute: string): Promise<{ page: any; mod: any }> {
    const route = this.normalizeRoute(maybeRoute)

    return new Promise((resolve, reject) => {
      // @ts-ignore
      const fire = ({ error, page, mod }) => {
        this.pageRegisterEvents.off(route, fire)
        this.loadingRoutes.delete(route)

        if (error) {
          reject(error)
        } else {
          resolve({ page, mod })
        }
      }

      // If there's a cached version of the page, let's use it.
      const cachedPage = this.pageCache.get(route)
      if (cachedPage) {
        const { error, page, mod } = cachedPage
        error ? reject(error) : resolve({ page, mod })
        return
      }

      // Register a listener to get the page
      this.pageRegisterEvents.on(route, fire)

      // If the page is loading via SSR, we need to wait for it
      // rather downloading it again.
      if (document.querySelector(`script[data-next-page="${route}"]`)) {
        return
      }

      if (!this.loadingRoutes.has(route)) {
        if (process.env.__NEXT_GRANULAR_CHUNKS) {
          this.getDependencies(route).then(deps => {
            deps.forEach(d => {
              if (
                /\.js$/.test(d) &&
                !document.querySelector(`script[src^="${d}"]`)
              ) {
                this.loadScript(d, route, false)
              }
            })
            this.loadRoute(route)
            this.loadingRoutes.set(route, true)
          })
        } else {
          this.loadRoute(route)
          this.loadingRoutes.set(route, true)
        }
      }
    })
  }

  async loadRoute(maybeRoute: string) {
    const route = this.normalizeRoute(maybeRoute)
    let scriptRoute = route === '/' ? '/index.js' : `${route}.js`

    const url = `${this.assetPrefix}/_next/static/${encodeURIComponent(
      this.buildId
    )}/pages${scriptRoute}`
    this.loadScript(url, route, true)
  }

  loadScript(url: string, route: NormalizedRoute, isPage: boolean) {
    const script = document.createElement('script')
    if (process.env.__NEXT_MODERN_BUILD && 'noModule' in script) {
      script.type = 'module'
      // Only page bundle scripts need to have .module added to url,
      // dependencies already have it added during build manifest creation
      if (isPage) url = url.replace(/\.js$/, '.module.js')
    }
    // @ts-ignore
    script.crossOrigin = process.crossOrigin
    script.src = encodeURI(url)
    script.onerror = () => {
      const error = new Error(`Error loading script ${url}`)
      // @ts-ignore
      error.code = 'PAGE_LOAD_ERROR'
      this.pageRegisterEvents.emit(route, { error })
    }
    document.body.appendChild(script)
  }

  // This method if called by the route code.
  registerPage(maybeRoute: string, regFn: any) {
    const route = this.normalizeRoute(maybeRoute)
    const register = () => {
      try {
        const mod = regFn()
        const pageData = { page: mod.default || mod, mod }
        this.pageCache.set(route, pageData)
        this.pageRegisterEvents.emit(route, pageData)
      } catch (error) {
        this.pageCache.set(route, { error })
        this.pageRegisterEvents.emit(route, { error })
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      // Wait for webpack to become idle if it's not.
      // More info: https://github.com/zeit/next.js/pull/1511
      // @ts-ignore
      if (module.hot && module.hot.status() !== 'idle') {
        console.log(
          `Waiting for webpack to become "idle" to initialize the page: "${route}"`
        )

        const check = (status: unknown) => {
          if (status === 'idle') {
            // @ts-ignore
            module.hot.removeStatusHandler(check)
            register()
          }
        }
        // @ts-ignore
        module.hot.status(check)
        return
      }
    }

    register()
  }

  async prefetch(maybeRoute: string, isDependency: boolean) {
    const route = this.normalizeRoute(maybeRoute)
    let scriptRoute = `${route === '/' ? '/index' : route}.js`

    if (
      process.env.__NEXT_MODERN_BUILD &&
      'noModule' in document.createElement('script')
    ) {
      scriptRoute = scriptRoute.replace(/\.js$/, '.module.js')
    }
    const url =
      this.assetPrefix +
      (isDependency
        ? route
        : `/_next/static/${encodeURIComponent(
            this.buildId
          )}/pages${scriptRoute}`)

    // n.b. If preload is not supported, we fall back to `loadPage` which has
    // its own deduping mechanism.
    if (
      document.querySelector(
        `link[rel="preload"][href^="${url}"], script[data-next-page="${route}"]`
      )
    ) {
      return
    }

    // Inspired by quicklink, license: https://github.com/GoogleChromeLabs/quicklink/blob/master/LICENSE
    let cn
    // @ts-ignore
    if ((cn = navigator.connection)) {
      // Don't prefetch if the user is on 2G or if Save-Data is enabled.
      if ((cn.effectiveType || '').indexOf('2g') !== -1 || cn.saveData) {
        return
      }
    }

    if (process.env.__NEXT_GRANULAR_CHUNKS && !isDependency) {
      ;(await this.getDependencies(route)).forEach(url => {
        this.prefetch(url, true)
      })
    }

    // Feature detection is used to see if preload is supported
    // If not fall back to loading script tags before the page is loaded
    // https://caniuse.com/#feat=link-rel-preload
    if (hasPreload) {
      preloadScript(url)
      return
    }

    if (isDependency) {
      // loadPage will automatically handle depencies, so no need to
      // preload them manually
      return
    }

    if (document.readyState === 'complete') {
      return this.loadPage(route).catch(() => {})
    } else {
      return new Promise(resolve => {
        window.addEventListener('load', () => {
          this.loadPage(route).then(
            () => resolve(),
            () => resolve()
          )
        })
      })
    }
  }
}
