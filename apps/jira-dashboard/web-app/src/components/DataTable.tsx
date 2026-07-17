import { Item } from '../types';
import { TEST_IDS, getItemTestId } from '../utils/test-ids';

interface DataTableProps {
  items: Item[];
  onDelete: (id: string) => void;
  loading: boolean;
}

export function DataTable({ items, onDelete, loading }: DataTableProps) {
  if (loading) {
    return <div className="loading" data-testid={TEST_IDS.DATA_TABLE.LOADING}>Loading items...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state" data-testid={TEST_IDS.DATA_TABLE.EMPTY_STATE}>
        <p>No items found. Create your first item above!</p>
      </div>
    );
  }

  return (
    <div className="table-container" data-testid={TEST_IDS.DATA_TABLE.CONTAINER}>
      <table data-testid={TEST_IDS.DATA_TABLE.TABLE}>
        <thead data-testid={TEST_IDS.DATA_TABLE.THEAD}>
          <tr>
            <th data-testid={TEST_IDS.DATA_TABLE.HEADER_NAME}>Name</th>
            <th data-testid={TEST_IDS.DATA_TABLE.HEADER_DESCRIPTION}>Description</th>
            <th data-testid={TEST_IDS.DATA_TABLE.HEADER_CREATED_AT}>Created At</th>
            <th data-testid={TEST_IDS.DATA_TABLE.HEADER_ACTIONS}>Actions</th>
          </tr>
        </thead>
        <tbody data-testid={TEST_IDS.DATA_TABLE.TBODY}>
          {items.map((item) => (
            <tr key={item.pk} data-testid={getItemTestId(TEST_IDS.DATA_TABLE.ROW, item.pk)}>
              <td data-testid={getItemTestId(TEST_IDS.DATA_TABLE.CELL_NAME, item.pk)}>{item.name}</td>
              <td data-testid={getItemTestId(TEST_IDS.DATA_TABLE.CELL_DESCRIPTION, item.pk)}>{item.description || '-'}</td>
              <td data-testid={getItemTestId(TEST_IDS.DATA_TABLE.CELL_CREATED_AT, item.pk)}>{new Date(item.createdAt).toLocaleString()}</td>
              <td data-testid={getItemTestId(TEST_IDS.DATA_TABLE.CELL_ACTIONS, item.pk)}>
                <button
                  className="delete-btn"
                  onClick={() => onDelete(item.pk)}
                  title="Delete item"
                  data-testid={getItemTestId(TEST_IDS.DATA_TABLE.DELETE_BUTTON, item.pk)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
