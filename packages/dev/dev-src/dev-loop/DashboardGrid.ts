import { Box } from 'ink'
import React from 'react'

export type DashboardGridProps<T> = {
  height: number
  items: readonly T[]
  layout: ColumnLayout
  renderItem: (item: T, isLast: boolean) => React.ReactElement
  width: number
}

export type ColumnLayout = {
  columnWidth: number
  columnsPerRow: number
  lineLimit: number
  rowGap: number
}

export type TerminalSize = {
  columns: number
  rows: number
}

const COLUMN_GAP = 1
const MIN_COLUMN_HEIGHT = 3

function DashboardGridComponent<T>(props: DashboardGridProps<T>): React.ReactElement {
  const rows = chunk(props.items, props.layout.columnsPerRow)
  return React.createElement(
    Box,
    { flexDirection: 'column', height: props.height, overflow: 'hidden', width: props.width },
    ...rows.map((row, rowIndex) =>
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          key: rowIndex,
          marginBottom: rowIndex === rows.length - 1 ? 0 : props.layout.rowGap,
        },
        ...row.map((item, itemIndex) => props.renderItem(item, itemIndex === row.length - 1)),
      )
    ),
  )
}

/** DashboardGrid renders a fixed-width multi-column dashboard and owns its layout helpers. */
export const DashboardGrid = Object.assign(DashboardGridComponent, {
  COLUMN_GAP,
  MIN_COLUMN_HEIGHT,
  availableRows,
  columnLayout,
  layoutHeight,
})

function columnLayout(
  size: TerminalSize,
  itemCount: number,
  targetColumnWidth: number,
  lineLimit: number,
  rowGap: number,
): ColumnLayout {
  const availableColumns = Math.max(1, size.columns - 1)
  const columnsPerRow = Math.max(
    1,
    Math.min(itemCount, Math.floor((availableColumns + COLUMN_GAP) / (targetColumnWidth + COLUMN_GAP))),
  )
  const columnWidth = Math.max(
    1,
    Math.floor((availableColumns - COLUMN_GAP * (columnsPerRow - 1)) / columnsPerRow),
  )

  return { columnWidth, columnsPerRow, lineLimit, rowGap }
}

function layoutHeight(layout: ColumnLayout, itemCount: number): number {
  const rowCount = Math.ceil(itemCount / layout.columnsPerRow)
  return rowCount * (layout.lineLimit + MIN_COLUMN_HEIGHT) + Math.max(0, rowCount - 1) * layout.rowGap
}

function availableRows(size: TerminalSize): number {
  return Math.max(1, size.rows - 1)
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
