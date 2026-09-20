import { FS } from '@shared'

/**
 * Reminders are the repository's way of telling Ro that a dated thing is due. They exist because
 * some work can only be judged after time has passed — a measurement worth repeating a week later,
 * a branch to re-check once another lands — and a note written into a plan is read by whoever opens
 * that plan, which is nobody on the day it matters. `board` prints the due ones, so a reminder
 * reaches the person through a command they already run rather than through their memory.
 *
 * A reminder is one line in `Docs/Roadmap/Reminders.md`: `- YYYY-MM-DD — what to do and why`. The
 * date is when it becomes worth raising, not a deadline. Nothing expires a reminder automatically;
 * it is due every day until someone deletes the line, because a reminder that stops asking is one
 * that failed at its only job.
 */

export const REMINDERS_PATH = 'Docs/Roadmap/Reminders.md'

const REMINDER_LINE = /^-\s*(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+?)\s*$/

export type Reminder = {
  due: string
  text: string
}

/** dueReminders returns the reminders a date has reached, oldest first. */
export function dueReminders(source: string, today: string): Reminder[] {
  return source
    .split('\n')
    .map(line => REMINDER_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ due: match[1] ?? '', text: match[2] ?? '' }))
    .filter(reminder => reminder.due <= today)
    .sort((left, right) => left.due.localeCompare(right.due))
}

/** readDueReminders reads the reminder file, treating a missing one as no reminders at all. */
export async function readDueReminders(root: string, today: string): Promise<Reminder[]> {
  const path = FS.resolvePath(REMINDERS_PATH, root)
  if (!(await FS.isFile(path))) {
    return []
  }
  return dueReminders(await FS.readText(path), today)
}

/** formatReminders renders the due reminders for the board, or '' when none are due. */
export function formatReminders(reminders: readonly Reminder[]): string {
  if (reminders.length === 0) {
    return ''
  }
  const rows = reminders.map(reminder => `  ${reminder.due}  ${reminder.text}`)
  return [`Due (${REMINDERS_PATH}):`, ...rows].join('\n')
}
