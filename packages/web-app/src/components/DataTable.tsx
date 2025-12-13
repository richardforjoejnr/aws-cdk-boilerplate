import { Item } from '../types';

interface DataTableProps {
  items: Item[];
  onDelete: (id: string) => void;
  loading: boolean;
}

export function DataTable({ items, onDelete, loading }: DataTableProps) {
  if (loading) {
    return <div className="loading">Loading items...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>No items found. Create your first item above!</p>
      </div>
    );
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.pk}>
              <td>{item.name}</td>
              <td>{item.description || '-'}</td>
              <td>{new Date(item.createdAt).toLocaleString()}</td>
              <td>
                <button
                  className="delete-btn"
                  onClick={() => onDelete(item.pk)}
                  title="Delete item"
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
