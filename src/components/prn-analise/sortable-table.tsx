import { useState, useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ColumnDef = {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  render?: (val: any, row: any) => React.ReactNode
}

export function SortableTable({ data = [], columns }: { data?: any[]; columns: ColumnDef[] }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(
    null,
  )

  const sortedData = useMemo(() => {
    if (!sortConfig) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key]
      const bVal = b[sortConfig.key]
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortConfig])

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc'
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc'
    setSortConfig({ key, direction })
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
      <Table>
        <TableHeader className="bg-gray-50 border-b border-gray-200">
          <TableRow className="hover:bg-transparent border-gray-200">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={`py-4 ${
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                }`}
              >
                {col.sortable !== false ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-2 font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-800 -ml-2 text-xs uppercase tracking-widest transition-all"
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortConfig?.key === col.key ? (
                      sortConfig.direction === 'asc' ? (
                        <ArrowUp className="ml-1.5 h-3 w-3 text-blue-600" />
                      ) : (
                        <ArrowDown className="ml-1.5 h-3 w-3 text-blue-600" />
                      )
                    ) : (
                      <ArrowUpDown className="ml-1.5 h-3 w-3 opacity-30" />
                    )}
                  </Button>
                ) : (
                  <span className="px-2 font-bold text-gray-500 text-xs uppercase tracking-widest">{col.label}</span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.length === 0 && (
            <TableRow className="border-gray-100 hover:bg-transparent">
              <TableCell colSpan={columns.length} className="text-center py-12 text-gray-400 font-medium">
                Nenhum registro encontrado.
              </TableCell>
            </TableRow>
          )}
          {sortedData.map((row, i) => (
            <TableRow key={i} className="border-gray-100 hover:bg-gray-50 transition-all duration-200">
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={`py-4 text-sm font-medium break-words whitespace-normal max-w-[240px] ${
                    col.align === 'right'
                      ? 'text-right text-gray-800'
                      : col.align === 'center'
                        ? 'text-center text-gray-600'
                        : 'text-left text-gray-700'
                  }`}
                >
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
