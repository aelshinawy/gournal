import { format, startOfMonth, startOfWeek, subDays } from 'date-fns';

export const Titles = {
    weeklyTitle: (now: Date) =>
      `Weekly (${format(startOfWeek(now), 'MMM dd')} - ${format(now, 'MMM dd')})`,
    monthlyTitle: (now: Date) =>
      `Monthly (${format(startOfMonth(now), 'MMM dd')} - ${format(now, 'MMM dd')})`,
    dailyTitle: (now: Date) =>
      `Today (${format(now, 'yyyy-MM-dd')})`,
    yesterdayTitle: (now: Date) =>
      `Yesterday (${format(subDays(now, 1), 'MMM dd')} → ${format(now, 'MMM dd')})`
  };