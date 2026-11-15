import { endOfDay, parse, startOfDay } from 'date-fns';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseBound(value: string, side: 'from' | 'to'): string {
  let date: Date;
  if (DATE_ONLY.test(value)) {
    const day = parse(value, 'yyyy-MM-dd', new Date());
    date = side === 'from' ? startOfDay(day) : endOfDay(day);
  } else {
    date = new Date(value);
  }
  if (isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}
