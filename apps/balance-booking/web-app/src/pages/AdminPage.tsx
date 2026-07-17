import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlClient, type Booking, type ClassInstance } from '../lib/api';
import {
  ADMIN_CREATE_CLASS,
  ADMIN_DELETE_CLASS,
  ADMIN_LIST_BOOKINGS,
  ADMIN_UPDATE_CLASS,
  LIST_CLASSES,
} from '../lib/queries';
import { useAuth } from '../contexts/AuthContext';

type RowMode = 'view' | 'edit' | 'bookings';

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [rowModes, setRowModes] = useState<Record<string, RowMode>>({});

  const isAdmin = user?.groups.includes('admin') ?? false;

  const { data: classes, isLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => {
      const res = await gqlClient().request<{ listClasses: ClassInstance[] }>(LIST_CLASSES);
      return res.listClasses;
    },
    enabled: isAdmin,
  });

  const setMode = (id: string, mode: RowMode) => setRowModes((m) => ({ ...m, [id]: mode }));
  const refetchClasses = () => queryClient.invalidateQueries({ queryKey: ['classes'] });

  if (!isAdmin) {
    return (
      <section>
        <h1 className="text-4xl mt-0">Admin</h1>
        <p className="text-text-muted">You don't have admin access.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-4xl m-0">Admin</h1>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="px-5 py-2 rounded-full bg-charcoal text-white text-sm"
        >
          {showCreate ? 'Hide create form' : '+ Create class'}
        </button>
      </div>

      {showCreate && (
        <div className="mb-10 p-6 bg-white border border-stone rounded-lg">
          <CreateClassForm
            onCreated={() => {
              setShowCreate(false);
              refetchClasses();
            }}
          />
        </div>
      )}

      <h2 className="text-2xl mt-0 mb-4">Upcoming classes</h2>
      {isLoading && <p className="text-text-muted">Loading…</p>}
      {classes && classes.length === 0 && <p className="text-text-muted">No classes yet.</p>}
      <div className="flex flex-col gap-3">
        {classes?.map((cls) => (
          <ClassRow
            key={cls.classInstanceId}
            cls={cls}
            mode={rowModes[cls.classInstanceId] ?? 'view'}
            onSetMode={(m) => setMode(cls.classInstanceId, m)}
            onChange={refetchClasses}
          />
        ))}
      </div>
    </section>
  );
}

function ClassRow({
  cls,
  mode,
  onSetMode,
  onChange,
}: {
  cls: ClassInstance;
  mode: RowMode;
  onSetMode: (m: RowMode) => void;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const start = new Date(cls.startsAt);
  const date = start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const del = useMutation({
    mutationFn: async () =>
      gqlClient().request(ADMIN_DELETE_CLASS, {
        classInstanceId: cls.classInstanceId,
        classDate: cls.startsAt.slice(0, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      onChange();
    },
  });

  const onDelete = () => {
    const msg =
      cls.booked > 0
        ? `Delete "${cls.classTypeName}"? ${cls.booked} booking(s) will be cancelled.`
        : `Delete "${cls.classTypeName}"?`;
    if (window.confirm(msg)) del.mutate();
  };

  return (
    <article className="bg-white border border-stone rounded-lg overflow-hidden">
      <div className="flex items-center gap-5 p-4">
        <div className="text-center min-w-20">
          <div className="font-display text-lg text-charcoal">{time}</div>
          <div className="text-xs text-text-muted mt-1">{date}</div>
        </div>
        <div className="flex-1">
          <div className="font-medium">{cls.classTypeName}</div>
          <div className="text-sm text-text-muted mt-1">
            {cls.booked}/{cls.capacity} booked · £{cls.priceGBP.toFixed(2)} · {cls.instructor}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSetMode(mode === 'edit' ? 'view' : 'edit')}
            className="px-3 py-2 rounded-md border border-stone text-sm hover:bg-stone"
          >
            {mode === 'edit' ? 'Cancel' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => onSetMode(mode === 'bookings' ? 'view' : 'bookings')}
            className="px-3 py-2 rounded-md border border-stone text-sm hover:bg-stone"
          >
            {mode === 'bookings' ? 'Hide' : 'Bookings'} ({cls.booked})
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={del.isPending}
            className="px-3 py-2 rounded-md border border-stone text-sm text-error hover:bg-blush disabled:opacity-50"
          >
            {del.isPending ? '…' : 'Delete'}
          </button>
        </div>
      </div>
      {mode === 'edit' && (
        <div className="border-t border-stone p-4 bg-stone">
          <EditClassForm
            cls={cls}
            onSaved={() => {
              onSetMode('view');
              onChange();
            }}
          />
        </div>
      )}
      {mode === 'bookings' && (
        <div className="border-t border-stone p-4 bg-stone">
          <BookingsList classInstanceId={cls.classInstanceId} />
        </div>
      )}
      {del.error && <p className="text-error text-sm px-4 pb-3">{(del.error as Error).message}</p>}
    </article>
  );
}

function CreateClassForm({ onCreated }: { onCreated: () => void }) {
  const [classTypeName, setClassTypeName] = useState('Reformer — Flow It');
  const [classTypeSlug, setClassTypeSlug] = useState('reformer-flow-it');
  const [level, setLevel] = useState<'L1' | 'L2' | 'L3' | 'ALL'>('L1');
  const [format, setFormat] = useState('REFORMER');
  const [startsAt, setStartsAt] = useState('');
  const [durationMin, setDurationMin] = useState(45);
  const [capacity, setCapacity] = useState(8);
  const [priceGBP, setPriceGBP] = useState(20);
  const [instructor, setInstructor] = useState('Franki');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      return gqlClient().request(ADMIN_CREATE_CLASS, {
        input: {
          classTypeSlug,
          classTypeName,
          level,
          format,
          startsAt: new Date(startsAt).toISOString(),
          durationMin,
          capacity,
          priceGBP,
          instructor,
        },
      });
    },
    onSuccess: onCreated,
    onError: (err: Error) => setError(err.message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Class name">
        <input
          required
          value={classTypeName}
          onChange={(e) => setClassTypeName(e.target.value)}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Slug">
        <input
          required
          value={classTypeSlug}
          onChange={(e) => setClassTypeSlug(e.target.value)}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Level">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
          className="w-full p-3 border border-stone rounded-md bg-white"
        >
          <option value="L1">Level 1</option>
          <option value="L2">Level 2</option>
          <option value="L3">Level 3</option>
          <option value="ALL">All levels</option>
        </select>
      </Field>
      <Field label="Format">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="w-full p-3 border border-stone rounded-md bg-white"
        >
          <option value="REFORMER">Reformer</option>
          <option value="MAT">Mat</option>
          <option value="BARRE">Barre</option>
          <option value="INFRARED_REFORMER">Infrared Reformer</option>
          <option value="INFRARED_MAT">Infrared Mat</option>
        </select>
      </Field>
      <Field label="Starts at">
        <input
          required
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Duration (min)">
        <input
          required
          type="number"
          min={5}
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Capacity">
        <input
          required
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Price (£)">
        <input
          required
          type="number"
          min={0}
          step={0.5}
          value={priceGBP}
          onChange={(e) => setPriceGBP(Number(e.target.value))}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Instructor">
        <input
          required
          value={instructor}
          onChange={(e) => setInstructor(e.target.value)}
          className="w-full p-3 border border-stone rounded-md bg-white"
        />
      </Field>
      <div className="md:col-span-2 flex justify-end gap-3 mt-2">
        {error && <p className="text-error mr-auto">{error}</p>}
        <button
          type="submit"
          disabled={create.isPending}
          className="px-6 py-3 rounded-full bg-charcoal text-white disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create class'}
        </button>
      </div>
    </form>
  );
}

function EditClassForm({ cls, onSaved }: { cls: ClassInstance; onSaved: () => void }) {
  const [classTypeName, setClassTypeName] = useState(cls.classTypeName);
  const [startsAt, setStartsAt] = useState(toLocalInput(cls.startsAt));
  const [durationMin, setDurationMin] = useState(cls.durationMin);
  const [capacity, setCapacity] = useState(cls.capacity);
  const [priceGBP, setPriceGBP] = useState(cls.priceGBP);
  const [instructor, setInstructor] = useState(cls.instructor);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: async () =>
      gqlClient().request(ADMIN_UPDATE_CLASS, {
        input: {
          classInstanceId: cls.classInstanceId,
          classDate: cls.startsAt.slice(0, 10),
          classTypeName,
          startsAt: new Date(startsAt).toISOString(),
          durationMin,
          capacity,
          priceGBP,
          instructor,
        },
      }),
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="Class name">
        <input
          required
          value={classTypeName}
          onChange={(e) => setClassTypeName(e.target.value)}
          className="w-full p-2 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Starts at (same date only)">
        <input
          required
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="w-full p-2 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Duration (min)">
        <input
          required
          type="number"
          min={5}
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="w-full p-2 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Capacity">
        <input
          required
          type="number"
          min={cls.booked}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          className="w-full p-2 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Price (£)">
        <input
          required
          type="number"
          min={0}
          step={0.5}
          value={priceGBP}
          onChange={(e) => setPriceGBP(Number(e.target.value))}
          className="w-full p-2 border border-stone rounded-md bg-white"
        />
      </Field>
      <Field label="Instructor">
        <input
          required
          value={instructor}
          onChange={(e) => setInstructor(e.target.value)}
          className="w-full p-2 border border-stone rounded-md bg-white"
        />
      </Field>
      <div className="md:col-span-2 flex justify-end gap-3">
        {error && <p className="text-error mr-auto text-sm">{error}</p>}
        <button
          type="submit"
          disabled={update.isPending}
          className="px-5 py-2 rounded-full bg-charcoal text-white disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function BookingsList({ classInstanceId }: { classInstanceId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-bookings', classInstanceId],
    queryFn: async () => {
      const res = await gqlClient().request<{ adminListBookings: Booking[] }>(ADMIN_LIST_BOOKINGS, {
        classInstanceId,
      });
      return res.adminListBookings;
    },
  });

  if (isLoading) return <p className="text-text-muted text-sm">Loading…</p>;
  if (error) return <p className="text-error text-sm">{(error as Error).message}</p>;
  if (!data || data.length === 0) {
    return <p className="text-text-muted text-sm">No bookings yet.</p>;
  }

  return (
    <ul className="list-none p-0 m-0 divide-y divide-stone bg-white border border-stone rounded-md">
      {data.map((b) => (
        <li key={b.bookingId} className="px-4 py-3 flex items-center justify-between text-sm">
          <span className="font-mono">{b.userId.slice(0, 8)}…</span>
          <span className="text-text-muted">{b.paymentMethod}</span>
          <span className="text-text-muted">
            {new Date(b.createdAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-medium text-sm">{label}</span>
      {children}
    </label>
  );
}

function toLocalInput(iso: string): string {
  // Format ISO datetime as YYYY-MM-DDTHH:mm for <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
