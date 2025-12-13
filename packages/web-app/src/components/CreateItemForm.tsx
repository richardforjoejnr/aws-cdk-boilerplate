import { useState } from 'react';
import { CreateItemInput } from '../types';

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
    <form onSubmit={handleSubmit} className="create-form">
      <h2>Create New Item</h2>
      <div className="form-group">
        <label htmlFor="name">
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
        />
      </div>

      <div className="form-group">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter item description (optional)"
          disabled={loading}
          rows={3}
        />
      </div>

      <button type="submit" disabled={loading || !name.trim()}>
        {loading ? 'Creating...' : 'Create Item'}
      </button>
    </form>
  );
}
