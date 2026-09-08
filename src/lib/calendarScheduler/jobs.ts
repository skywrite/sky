import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { CalendarFields, CalendarJob, CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import type { CalendarEventSnapshot } from './updateTypes.ts'
import { validateEventFields, requireEditable } from './updateValidation.ts'

interface SavedJob extends CalendarJob {
  fields: CalendarFields
  reviewKey: string
  saving: boolean
  owner: string
  update?: CalendarEventSnapshot
}

/** Persist before Save. An interrupted or uncertain send is never replayed automatically. */
export class CalendarJobs {
  private readonly owner = crypto.randomUUID()
  private readonly completed = new Map<string, CalendarJob>()

  constructor(
    private readonly host: CalendarSchedulerHost,
    private readonly hold: () => () => void = () => () => {},
  ) {}

  private file(id: string): string {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id))
      throw new Error('Invalid meeting request.')
    return path.join(this.host.dir, `${id}.json`)
  }

  private async read(id: string): Promise<SavedJob | null> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as SavedJob
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null
      throw error
    }
  }

  private view(job: SavedJob): CalendarJob {
    const completed = this.completed.get(job.id)
    if (completed) return completed
    if ((job.state === 'creating' || job.state === 'updating') && job.owner !== this.owner) {
      return {
        id: job.id,
        state: job.saving ? 'uncertain' : 'failed',
        ...(job.update ? { operation: 'update' as const } : {}),
        message: job.saving
          ? 'Sky restarted during a calendar save. Check Google Calendar before trying again.'
          : 'Sky restarted before the meeting was saved. You can try again.',
      }
    }
    const { id, state, message, result, operation } = job
    return { id, state, message, result, ...(operation ? { operation } : {}) }
  }

  async get(id: string): Promise<CalendarJob | null> {
    const job = await this.read(id)
    return job ? this.view(job) : null
  }

  async start(
    id: string,
    fields: CalendarFields,
    reviewKey: string,
    update?: CalendarEventSnapshot,
  ): Promise<CalendarJob> {
    await mkdir(this.host.dir, { recursive: true })
    const job: SavedJob = {
      id,
      fields,
      reviewKey,
      state: update ? 'updating' : 'creating',
      saving: false,
      owner: this.owner,
      ...(update ? { update, operation: 'update' } : {}),
    }
    try {
      // Exclusive creation serializes repeated clicks, network retries, and competing requests.
      await this.save(job, true)
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      const previous = await this.read(id)
      if (
        !previous ||
        JSON.stringify(previous.fields) !== JSON.stringify(fields) ||
        JSON.stringify(previous.update) !== JSON.stringify(update)
      )
        throw new Error('This request already belongs to another meeting.')
      return this.view(previous)
    }
    void this.run(job)
    return this.view(job)
  }

  private async save(job: SavedJob, initial = false): Promise<void> {
    const target = this.file(job.id)
    const temporary = `${target}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(job), { flag: 'wx', mode: 0o600 })
      if (initial) await link(temporary, target)
      else await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  private async run(job: SavedJob): Promise<void> {
    const release = this.hold()
    const save = () => this.save(job)
    try {
      const beforeSave = async () => {
        if (job.update) {
          if (!this.host.updates) throw new Error('This calendar provider does not support updates.')
          const current = await this.host.updates.read(job.update.ref)
          requireEditable(current)
          if (current.version !== job.update.version)
            throw new Error('This event changed. Prepare the update again before saving.')
        }
        const available = await this.host.availability(job.fields, job.update)
        if (available.reviewKey !== job.reviewKey)
          throw new Error('Your calendar changed. Review the updated conflicts before saving this event.')
      }
      await beforeSave()
      const hooks = {
        beforeSave,
        saving: async () => {
          job.saving = true
          await save()
        },
      }
      job.result = job.update
        ? await this.host.updates!.save(job.update, validateEventFields(job.fields), hooks)
        : await this.host.create(job.fields, hooks)
      job.state = job.update ? 'updated' : 'created'
    } catch (error) {
      job.state = job.saving ? 'uncertain' : 'failed'
      job.message = job.saving
        ? 'The calendar save could not be confirmed. Check Google Calendar before trying again.'
        : error instanceof Error
          ? error.message
          : 'The meeting could not be created.'
    } finally {
      try {
        await save()
      } catch {
        /* The pre-save record remains uncertain if the final write fails. */
      }
      this.completed.set(job.id, this.view(job))
      release()
    }
  }
}
