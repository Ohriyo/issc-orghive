import { tableFeatures, type ColumnDef, type RowData } from '@tanstack/react-table';

/**
 * Admin tables render what the server sent, in the server's order: paging, sorting and
 * filtering happen in the API, so only TanStack Table's core is registered.
 */
export const dataTableFeatures = tableFeatures({});
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData>;
