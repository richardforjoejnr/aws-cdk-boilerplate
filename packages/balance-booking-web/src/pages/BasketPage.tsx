import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlClient, type MemberProfile } from '../lib/api';
import { BOOK_BASKET, MY_PROFILE } from '../lib/queries';
import { useBasket } from '../contexts/BasketContext';

export function BasketPage() {
  const { items, remove, clear, total } = useBasket();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await gqlClient().request<{ myProfile: MemberProfile }>(MY_PROFILE);
      return res.myProfile;
    },
  });

  const book = useMutation({
    mutationFn: async () => {
      return gqlClient().request(BOOK_BASKET, {
        items: items.map((i) => ({
          classInstanceId: i.classInstanceId,
          classDate: i.startsAt.slice(0, 10),
        })),
      });
    },
    onSuccess: () => {
      clear();
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      navigate('/my/bookings');
    },
    onError: (err: Error) => setError(err.message),
  });

  if (items.length === 0) {
    return (
      <section>
        <h1 className="text-4xl mt-0">Your basket</h1>
        <p className="text-text-muted">Nothing here yet — head to the schedule to add classes.</p>
      </section>
    );
  }

  const parqDone = !!profile?.parqCompletedAt;

  return (
    <section>
      <h1 className="text-4xl mt-0">Your basket</h1>
      <ul className="bg-white border border-stone rounded-lg divide-y divide-stone p-0 list-none mt-6">
        {items.map((item) => (
          <li key={item.classInstanceId} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{item.classTypeName}</div>
              <div className="text-sm text-text-muted">
                {new Date(item.startsAt).toLocaleString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span>£{item.priceGBP.toFixed(2)}</span>
              <button
                type="button"
                onClick={() => remove(item.classInstanceId)}
                className="text-text-muted hover:text-error"
                aria-label={`Remove ${item.classTypeName}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center justify-between">
        <div className="text-text-muted">Total</div>
        <div className="text-2xl font-display">£{total.toFixed(2)}</div>
      </div>
      {!parqDone && (
        <div className="mt-6 p-4 bg-butter rounded-lg">
          <p className="m-0 mb-3">
            Before your first booking we need a few quick health questions (one time only).
          </p>
          <button
            type="button"
            onClick={() => navigate('/parq')}
            className="px-6 py-3 rounded-full bg-charcoal text-white"
          >
            Complete PAR-Q
          </button>
        </div>
      )}
      {error && <p className="text-error mt-4">{error}</p>}
      {parqDone && (
        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={clear}
            className="px-6 py-3 rounded-full border border-stone text-text-muted"
          >
            Clear basket
          </button>
          <button
            type="button"
            onClick={() => book.mutate()}
            disabled={book.isPending}
            className="px-8 py-3 rounded-full bg-charcoal text-white disabled:opacity-50"
          >
            {book.isPending ? 'Booking…' : 'Confirm booking (no payment in POC)'}
          </button>
        </div>
      )}
    </section>
  );
}
