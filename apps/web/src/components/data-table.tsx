import { useTable, type RowData } from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { dataTableFeatures, type DataTableColumn } from './data-table-features';

export interface DataTableProps<TData extends RowData> {
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  /** Read by screen readers; say what the table lists. */
  caption: string;
  /** Shown in place of rows when there are none. */
  empty: React.ReactNode;
  rowClassName?: (row: TData) => string | undefined;
  /** Extra classes per column id, e.g. to right-align numbers. */
  cellClassName?: Partial<Record<string, string>>;
}

/**
 * The shadcn data table: a white panel that scrolls sideways inside itself on narrow
 * screens (never the page), headers in muted ink, numbers in tabular figures.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  caption,
  empty,
  rowClassName,
  cellClassName = {},
}: DataTableProps<TData>) {
  const table = useTable({ features: dataTableFeatures, data, columns, getRowId });
  const rows = table.getRowModel().rows;

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id} className={cellClassName[header.column.id]}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.id} className={rowClassName?.(row.original)}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={cn(cellClassName[cell.column.id])}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-24 text-center text-ink-muted">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
