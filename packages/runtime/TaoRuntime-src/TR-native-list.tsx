import React from 'react'

export type TaoNativeListRenderInfo<ItemT> = {
  index: number
  item: ItemT
}

export type TaoNativeListProps<ItemT> = {
  data: readonly ItemT[]
  keyExtractor?: (item: ItemT, index: number) => string
  renderItem: (info: TaoNativeListRenderInfo<ItemT>) => React.ReactElement | null
}

export type TaoNativeSection<ItemT> = {
  data: readonly ItemT[]
  key?: string
  title?: string
}

export type TaoNativeSectionListProps<ItemT> = {
  keyExtractor?: (item: ItemT, index: number) => string
  renderItem: (info: TaoNativeListRenderInfo<ItemT>) => React.ReactElement | null
  sections: readonly TaoNativeSection<ItemT>[]
}

export type TaoNativeListDriver = {
  FlatList: React.ComponentType<any>
  SectionList: React.ComponentType<any>
}

let testDriver: TaoNativeListDriver | undefined

/** NativeList exposes React Native virtualized list helpers. */
export const NativeList = {
  /** Flat renders a React Native FlatList. */
  Flat<ItemT>(props: TaoNativeListProps<ItemT>): React.ReactElement {
    const FlatList = nativeListDriver().FlatList as React.ComponentType<TaoNativeListProps<ItemT>>
    return <FlatList {...props} />
  },

  /** Section renders a React Native SectionList. */
  Section<ItemT>(props: TaoNativeSectionListProps<ItemT>): React.ReactElement {
    const SectionList = nativeListDriver().SectionList as React.ComponentType<TaoNativeSectionListProps<ItemT>>
    return <SectionList {...props} />
  },

  /** itemKey creates a stable key extractor for object items that carry a named field. */
  itemKey<ItemT extends Record<string, unknown>>(field: keyof ItemT): (item: ItemT, index: number) => string {
    return (item, index) => String(item[field] ?? index)
  },

  /** indexKey creates a key extractor based on the rendered item index. */
  indexKey(): (_item: unknown, index: number) => string {
    return (_item, index) => String(index)
  },

  /** setDriverForTests replaces React Native list components for deterministic runtime tests. */
  setDriverForTests(driver?: TaoNativeListDriver): void {
    testDriver = driver
  },
} as const

function nativeListDriver(): TaoNativeListDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      FlatList(props) {
        return (
          <>
            {props.data.map((item: unknown, index: number) => (
              <React.Fragment key={props.keyExtractor?.(item, index) ?? index}>
                {props.renderItem({ index, item })}
              </React.Fragment>
            ))}
          </>
        )
      },
      SectionList(props) {
        return (
          <>
            {props.sections.flatMap((section: TaoNativeSection<unknown>, sectionIndex: number) =>
              section.data.map((item: unknown, index: number) => (
                <React.Fragment
                  key={`${section.key ?? section.title ?? sectionIndex}:${props.keyExtractor?.(item, index) ?? index}`}
                >
                  {props.renderItem({ index, item })}
                </React.Fragment>
              ))
            )}
          </>
        )
      },
    }
  }

  const RN = require('react-native') as TaoNativeListDriver
  return {
    FlatList: RN.FlatList,
    SectionList: RN.SectionList,
  }
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
