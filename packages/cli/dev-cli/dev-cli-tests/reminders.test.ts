import { Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { dueReminders, formatReminders, readDueReminders, REMINDERS_PATH } from '../dev-cli-src/doctor/Reminders'

const SOURCE = [
  '# Reminders',
  '',
  'Prose that mentions a 2026-01-01 date but is not a reminder line.',
  '',
  '- 2026-09-27 — Re-measure agent context usage against the 2026-09-20 baseline.',
  '- 2026-09-21 — Check whether the other branch landed.',
  '- 2027-01-01 — Something far off.',
].join('\n')

Describe('reminders', () => {
  Test('raises only the reminders whose day has come, oldest first', () => {
    Expect(dueReminders(SOURCE, '2026-09-28').map(reminder => reminder.due)).toEqual(['2026-09-21', '2026-09-27'])
  })

  Test('raises a reminder on its own day, since the date is when it becomes worth saying', () => {
    Expect(dueReminders(SOURCE, '2026-09-21').map(reminder => reminder.due)).toEqual(['2026-09-21'])
  })

  Test('stays quiet before the day, and reads prose containing a date as prose', () => {
    Expect(dueReminders(SOURCE, '2026-09-20')).toEqual([])
  })

  Test('keeps the text, which is the part a person acts on', () => {
    Expect(dueReminders(SOURCE, '2026-09-21')[0]?.text).toEqual('Check whether the other branch landed.')
  })

  Test('prints nothing at all when nothing is due, rather than an empty heading', () => {
    Expect(formatReminders([])).toEqual('')
  })

  Test('names the file to edit, because acting on a reminder means deleting its line', () => {
    Expect(formatReminders([{ due: '2026-09-21', text: 'Check it.' }]).includes(REMINDERS_PATH)).toEqual(true)
  })

  Test('treats a checkout with no reminder file as one with nothing due', async () => {
    Expect(await readDueReminders(await mkTestDir('reminders-empty'), '2099-01-01')).toEqual([])
  })

  Test('reads the reminders this repository ships, and finds the re-measurement among them', async () => {
    const reminders = await readDueReminders(Repo.getRoot(), '2099-01-01')

    Expect(reminders.length).toBeGreaterThan(0)
    Expect(reminders.some(reminder => reminder.text.includes('Re-measure agent context usage'))).toEqual(true)
  })
})
