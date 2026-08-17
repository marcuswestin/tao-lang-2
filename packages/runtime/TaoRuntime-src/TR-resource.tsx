import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import React from 'react'

type QueryStatus = 'error' | 'loading' | 'success'

export type TaoResourceQueryOptions<T> = {
  enabled?: boolean
  initialData?: T
  key: QueryKey
  load: () => Promise<T> | T
  staleTime?: number
}

export type TaoResourceQuery<T> = {
  data: T | undefined
  error: unknown
  isError: boolean
  isLoading: boolean
  isSuccess: boolean
  refetch(): Promise<void>
  status: QueryStatus
}

export type TaoResourceMutationOptions<Input, Output> = {
  invalidate?: readonly QueryKey[]
  save: (input: Input) => Promise<Output> | Output
}

export type TaoResourceMutation<Input, Output> = {
  data: Output | undefined
  error: unknown
  isError: boolean
  isIdle: boolean
  isLoading: boolean
  isSuccess: boolean
  mutate(input: Input): void
  mutateAsync(input: Input): Promise<Output>
  reset(): void
  status: QueryStatus | 'idle'
}

export type TaoResourceMutationAction = {
  invoke(): void
}

/** ResourceProvider creates the async resource cache for one generated Tao app. */
export function ResourceProvider(props: { children?: React.ReactNode }): React.JSX.Element {
  const [client] = React.useState(() =>
    new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          refetchOnWindowFocus: false,
          retry: false,
        },
      },
    })
  )
  React.useEffect(() => () => client.clear(), [client])

  return React.createElement(QueryClientProvider, { client }, props.children)
}

/** Resource exposes React Native app data helpers backed by proven React libraries. */
export const Resource = {
  /** mutation writes async app data through TanStack Query mutation state. */
  mutation<Input, Output>(options: TaoResourceMutationOptions<Input, Output>): TaoResourceMutation<Input, Output> {
    const client = useQueryClient()
    const mutation = useMutation<Output, Error, Input>({
      mutationFn: async input => options.save(input),
      onSuccess: async () => {
        await invalidateKeys(client, options.invalidate ?? [])
      },
    })

    return {
      data: mutation.data,
      error: mutation.error,
      isError: mutation.isError,
      isIdle: mutation.isIdle,
      isLoading: mutation.isPending,
      isSuccess: mutation.isSuccess,
      mutate: mutation.mutate,
      mutateAsync: mutation.mutateAsync,
      reset: mutation.reset,
      status: mutation.isIdle ? 'idle' : mutation.isPending ? 'loading' : mutation.isError ? 'error' : 'success',
    }
  },

  /** mutationAction adapts a resource mutation into a Pressable-compatible action. */
  mutationAction<Input, Output>(
    mutation: TaoResourceMutation<Input, Output>,
    input: Input,
  ): TaoResourceMutationAction {
    return {
      invoke() {
        mutation.mutate(input)
      },
    }
  },

  /** query reads one async resource through TanStack Query. */
  query<T>(options: TaoResourceQueryOptions<T>): TaoResourceQuery<T> {
    const query = useQuery({
      enabled: options.enabled,
      initialData: options.initialData,
      queryFn: options.load,
      queryKey: options.key,
      staleTime: options.staleTime,
    })

    return {
      data: query.data,
      error: query.error,
      isError: query.isError,
      isLoading: query.isPending,
      isSuccess: query.isSuccess,
      refetch: async () => {
        await query.refetch()
      },
      status: query.isPending ? 'loading' : query.isError ? 'error' : 'success',
    }
  },
} as const

async function invalidateKeys(client: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })))
}
