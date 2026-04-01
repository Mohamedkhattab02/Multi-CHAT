// Zero-dependency date formatting using native Intl API (no date-fns)

export function formatRelativeTime(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return rtf.format(-seconds, 'second');
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(-Math.floor(seconds / 86400), 'day');
  return new Intl.DateTimeFormat(undefined).format(date);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

export function formatTime(date: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

interface DateGroup<T> {
  label: string;
  items: T[];
}

export function groupByDate<T>(items: T[], getDate: (item: T) => Date): DateGroup<T>[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7 = new Date(today.getTime() - 7 * 86400000);
  const last30 = new Date(today.getTime() - 30 * 86400000);

  const groups: DateGroup<T>[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Previous 30 days', items: [] },
    { label: 'Older', items: [] },
  ];

  for (const item of items) {
    const date = getDate(item);
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (d >= today) groups[0].items.push(item);
    else if (d >= yesterday) groups[1].items.push(item);
    else if (d >= last7) groups[2].items.push(item);
    else if (d >= last30) groups[3].items.push(item);
    else groups[4].items.push(item);
  }

  return groups.filter((g) => g.items.length > 0);
}
