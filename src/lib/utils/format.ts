// Zero-dependency date formatting using native Intl API (no date-fns)

export function formatRelativeTime(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat('auto', { numeric: 'auto' });
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return rtf.format(-seconds, 'second');
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(-Math.floor(seconds / 86400), 'day');
  return new Intl.DateTimeFormat('auto').format(date);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('auto', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

export function formatTime(date: Date | string): string {
  return new Intl.DateTimeFormat('auto', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

export function groupByDate(dates: Date[]): Map<string, Date[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7 = new Date(today.getTime() - 7 * 86400000);
  const last30 = new Date(today.getTime() - 30 * 86400000);

  const groups = new Map<string, Date[]>([
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Previous 30 days', []],
    ['Older', []],
  ]);

  for (const date of dates) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (d >= today) groups.get('Today')!.push(date);
    else if (d >= yesterday) groups.get('Yesterday')!.push(date);
    else if (d >= last7) groups.get('Previous 7 days')!.push(date);
    else if (d >= last30) groups.get('Previous 30 days')!.push(date);
    else groups.get('Older')!.push(date);
  }

  return groups;
}
