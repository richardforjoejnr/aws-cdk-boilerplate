import { useState } from 'react';
import { CreateItemInput } from '../types';
import { TEST_IDS } from '../utils/test-ids';

interface CreateItemFormProps {
  onCreate: (input: CreateItemInput) => void;
  loading: boolean;
}

export function CreateItemForm({ onCreate, loading }: CreateItemFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('Name is required');
      return;
    }

    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
    });

    // Reset form
    setName('');
    setDescription('');
  };

  return (
    <form onSubmit={handleSubmit} className="create-form" data-testid={TEST_IDS.CREATE_FORM.CONTAINER}>
      <h2 data-testid={TEST_IDS.CREATE_FORM.TITLE}>Create New Item</h2>
      <div className="form-group">
        <label htmlFor="name" data-testid={TEST_IDS.CREATE_FORM.NAME_LABEL}>
          Name <span className="required">*</span>
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter item name"
          disabled={loading}
          required
          data-testid={TEST_IDS.CREATE_FORM.NAME_INPUT}
        />
      </div>

      <div className="form-group">
        <label htmlFor="description" data-testid={TEST_IDS.CREATE_FORM.DESCRIPTION_LABEL}>Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter item description (optional)"
          disabled={loading}
          rows={3}
          data-testid={TEST_IDS.CREATE_FORM.DESCRIPTION_INPUT}
        />
      </div>

      <button type="submit" disabled={loading || !name.trim()} data-testid={TEST_IDS.CREATE_FORM.SUBMIT_BUTTON}>
        {loading ? 'Creating...' : 'Create Item'}
      </button>
    </form>
  );
}
