import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gqlClient } from '../lib/api';
import { ADMIN_CREATE_CLASS } from '../lib/queries';
import { useAuth } from '../contexts/AuthContext';

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [classTypeName, setClassTypeName] = useState('Reformer — Flow It');
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState(8);
  const [priceGBP, setPriceGBP] = useState(20);
  const [message, setMessage] = useState<string | null>(null);

  if (!user?.groups.includes('admin')) {
    return (
      <section>
        <h1 className="text-4xl mt-0">Admin</h1>
        <p className="text-text-muted">You don't have admin access.</p>
      </section>
    );
  }

  const create = useMutation({
    mutationFn: async () => {
      return gqlClient().request(ADMIN_CREATE_CLASS, {
        input: {
          classTypeSlug: 'reformer-flow-it',
          classTypeName,
          level: 'L1',
          format: 'REFORMER',
          startsAt: new Date(startsAt).toISOString(),
          durationMin: 45,
          capacity,
          instructor: 'Franki',
          priceGBP,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      setMessage('Class created.');
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <section className="max-w-xl">
      <h1 className="text-4xl mt-0">Admin — create class</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-medium">Class name</span>
          <input
            required
            value={classTypeName}
            onChange={(e) => setClassTypeName(e.target.value)}
            className="p-3 border border-stone rounded-md bg-white"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">Starts at</span>
          <input
            required
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="p-3 border border-stone rounded-md bg-white"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">Capacity</span>
          <input
            required
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="p-3 border border-stone rounded-md bg-white"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">Price (£)</span>
          <input
            required
            type="number"
            min={0}
            step={0.5}
            value={priceGBP}
            onChange={(e) => setPriceGBP(Number(e.target.value))}
            className="p-3 border border-stone rounded-md bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="self-start px-8 py-3 rounded-full bg-charcoal text-white disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create class'}
        </button>
        {message && <p className="text-text-muted">{message}</p>}
      </form>
    </section>
  );
}
