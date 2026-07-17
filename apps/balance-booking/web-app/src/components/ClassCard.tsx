import type { ClassInstance } from '../lib/api';

interface Props {
  cls: ClassInstance;
  onAdd?: () => void;
  inBasket?: boolean;
}

export function ClassCard({ cls, onAdd, inBasket }: Props) {
  const start = new Date(cls.startsAt);
  const date = start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const remaining = cls.capacity - cls.booked;
  const isFull = remaining <= 0;

  return (
    <article className="bg-white border border-stone rounded-lg p-5 flex items-center gap-5">
      <div className="text-center min-w-20">
        <div className="font-display text-xl text-charcoal">{time}</div>
        <div className="text-sm text-text-muted mt-1">{date}</div>
      </div>
      <div className="flex-1">
        <h3 className="text-xl m-0">{cls.classTypeName}</h3>
        <p className="text-sm text-text-muted mt-1 mb-0">
          {levelLabel(cls.level)} · {cls.durationMin} min · with {cls.instructor}
        </p>
      </div>
      <div className="text-right">
        <div className="text-charcoal font-medium">£{cls.priceGBP.toFixed(2)}</div>
        <div className={`text-xs mt-1 ${isFull ? 'text-error' : 'text-text-muted'}`}>
          {isFull ? 'Full' : `${remaining} space${remaining === 1 ? '' : 's'} left`}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={isFull || inBasket}
        className="px-5 py-3 rounded-full bg-charcoal text-white text-sm disabled:bg-text-dim disabled:cursor-not-allowed hover:bg-blush-deep transition-colors"
      >
        {inBasket ? 'In basket' : isFull ? 'Full' : 'Add to basket'}
      </button>
    </article>
  );
}

function levelLabel(level: ClassInstance['level']): string {
  switch (level) {
    case 'L1':
      return 'Level 1 — beginner';
    case 'L2':
      return 'Level 2';
    case 'L3':
      return 'Level 3 — advanced';
    default:
      return 'All levels';
  }
}
