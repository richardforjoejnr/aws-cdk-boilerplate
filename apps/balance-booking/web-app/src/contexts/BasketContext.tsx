import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ClassInstance } from '../lib/api';

interface BasketContextValue {
  items: ClassInstance[];
  add: (item: ClassInstance) => void;
  remove: (classInstanceId: string) => void;
  clear: () => void;
  total: number;
}

const BasketContext = createContext<BasketContextValue | null>(null);

export function BasketProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ClassInstance[]>([]);

  const value: BasketContextValue = {
    items,
    add: (item) =>
      setItems((current) =>
        current.some((c) => c.classInstanceId === item.classInstanceId)
          ? current
          : [...current, item]
      ),
    remove: (id) => setItems((current) => current.filter((c) => c.classInstanceId !== id)),
    clear: () => setItems([]),
    total: items.reduce((sum, item) => sum + item.priceGBP, 0),
  };

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketContextValue {
  const ctx = useContext(BasketContext);
  if (!ctx) throw new Error('useBasket must be used inside BasketProvider');
  return ctx;
}
