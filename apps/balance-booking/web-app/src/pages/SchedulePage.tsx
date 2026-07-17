import { useQuery } from '@tanstack/react-query';
import { gqlClient, type ClassInstance } from '../lib/api';
import { LIST_CLASSES } from '../lib/queries';
import { ClassCard } from '../components/ClassCard';
import { useBasket } from '../contexts/BasketContext';

export function SchedulePage() {
  const { items, add } = useBasket();
  const { data, isLoading, error } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => {
      const res = await gqlClient().request<{ listClasses: ClassInstance[] }>(LIST_CLASSES);
      return res.listClasses;
    },
  });

  return (
    <section>
      <header className="mb-8">
        <h1 className="text-4xl m-0">Class schedule</h1>
        <p className="text-text-muted mt-2">
          Pick the classes you'd like to book — add as many as you need, then check out.
        </p>
      </header>
      {isLoading && <p className="text-text-muted">Loading the schedule…</p>}
      {error && <p className="text-error">Couldn't load the schedule. Please try again.</p>}
      {data && data.length === 0 && <p className="text-text-muted">No classes scheduled yet.</p>}
      <div className="flex flex-col gap-3">
        {data?.map((cls) => (
          <ClassCard
            key={cls.classInstanceId}
            cls={cls}
            inBasket={items.some((i) => i.classInstanceId === cls.classInstanceId)}
            onAdd={() => add(cls)}
          />
        ))}
      </div>
    </section>
  );
}
