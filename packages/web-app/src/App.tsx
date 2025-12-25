import { useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { DataTable } from './components/DataTable';
import { CreateItemForm } from './components/CreateItemForm';
import {
  Item,
  CreateItemInput,
  ListItemsResponse,
  CreateItemResponse,
  DeleteItemResponse
} from './types';
import * as queries from './graphql/operations';
import { TEST_IDS } from './utils/test-ids';
import './App.css';

const client = generateClient();

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch items on component mount
  useEffect(() => {
    void fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await client.graphql({
        query: queries.listItems,
      });

      if ('data' in response && response.data) {
        const data = response.data as ListItemsResponse;
        setItems(data.listItems);
      }
    } catch (err) {
      console.error('Error fetching items:', err);
      setError('Failed to fetch items. Please check your configuration.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (input: CreateItemInput) => {
    try {
      setCreating(true);
      setError(null);

      await client.graphql<CreateItemResponse>({
        query: queries.createItem,
        variables: { input },
      });

      // Refresh the list after creating
      await fetchItems();
    } catch (err) {
      console.error('Error creating item:', err);
      setError('Failed to create item. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) {
      return;
    }

    try {
      setError(null);

      await client.graphql<DeleteItemResponse>({
        query: queries.deleteItem,
        variables: { id },
      });

      // Refresh the list after deleting
      await fetchItems();
    } catch (err) {
      console.error('Error deleting item:', err);
      setError('Failed to delete item. Please try again.');
    }
  };

  return (
    <div className="app">
      <header data-testid={TEST_IDS.APP.HEADER}>
        <h1 data-testid={TEST_IDS.APP.TITLE}>AWS Boilerplate - Data Manager</h1>
        <p data-testid={TEST_IDS.APP.SUBTITLE}>Simple CRUD application using AWS AppSync and DynamoDB</p>
      </header>

      <main data-testid={TEST_IDS.APP.MAIN}>
        {error && (
          <div className="error-message" data-testid={TEST_IDS.APP.ERROR_MESSAGE}>
            {error}
          </div>
        )}

        <CreateItemForm onCreate={(input) => void handleCreate(input)} loading={creating} />

        <div className="items-section" data-testid={TEST_IDS.ITEMS.SECTION}>
          <div className="section-header" data-testid={TEST_IDS.ITEMS.HEADER}>
            <h2 data-testid={TEST_IDS.ITEMS.TITLE}>
              Items (<span data-testid={TEST_IDS.ITEMS.COUNT}>{items.length}</span>)
            </h2>
            <button
              onClick={() => void fetchItems()}
              disabled={loading}
              data-testid={TEST_IDS.ITEMS.REFRESH_BUTTON}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <DataTable items={items} onDelete={(id) => void handleDelete(id)} loading={loading} />
        </div>
      </main>
    </div>
  );
}

export default App;
