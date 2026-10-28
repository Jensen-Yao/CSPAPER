export const READING_STATUSES = ['todo', 'unread', 'reading', 'read', 'paused'] as const
export type ReadingStatus = typeof READING_STATUSES[number]
