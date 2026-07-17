import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlClient, type Booking } from '../lib/api';
import { CANCEL_BOOKING, MY_BOOKINGS } from '../lib/queries';

export function MyBookingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () => {
      const res = await gqlClient().request<{ myBookings: Booking[] }>(MY_BOOKINGS);
      return res.myBookings;
    },
  });

  const cancel = useMutation({
    mutationFn: (bookingId: string) => gqlClient().request(CANCEL_BOOKING, { bookingId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['classes'] });
    },
  });

  return (
    <section>
      <h1 className="text-4xl mt-0">My bookings</h1>
      {isLoading && <p className="text-text-muted">Loading…</p>}
      {data && data.length === 0 && <p className="text-text-muted">No bookings yet.</p>}
      <ul className="list-none p-0 mt-6 flex flex-col gap-3">
        {data?.map((b) => {
          const upcoming = new Date(b.startsAt) > new Date();
          const isCancelled = b.status === 'CANCELLED';
          return (
            <li
              key={b.bookingId}
              className="bg-white border border-stone rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">
                  {b.classTypeName}
                  {isCancelled && (
                    <span className="ml-3 text-xs px-2 py-1 rounded-full bg-stone text-text-muted">
                      Cancelled
                    </span>
                  )}
                </div>
                <div className="text-sm text-text-muted">
                  {new Date(b.startsAt).toLocaleString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              {upcoming && !isCancelled && (
                <button
                  type="button"
                  onClick={() => cancel.mutate(b.bookingId)}
                  disabled={cancel.isPending}
                  className="px-4 py-2 rounded-full border border-stone text-text-muted hover:text-error"
                >
                  Cancel
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
