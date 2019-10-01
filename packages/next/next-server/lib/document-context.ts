import * as React from 'react'
import { DocumentProps } from './utils'

export const DocumentContext: React.Context<{
  readonly _documentProps: DocumentProps
  readonly _devOnlyInvalidateCacheQueryString: string
}> = React.createContext(null as any)
