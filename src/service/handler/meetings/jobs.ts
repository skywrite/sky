import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { hold } from '../../activity.ts'
import type { MeetingFields, MeetingJob, MeetingsHost } from './types.ts'

interface SavedJob extends MeetingJob {
  fields: MeetingFields
  reviewKey: string
  saving: boolean
  owner: string
}

/** Persist before Save. An interrupted or uncertain send is never replayed automatically. */
export class MeetingJobs {
  private readonly owner = crypto.randomUUID()
  private readonly completed = new Map<string, MeetingJob>()

  constructor(private readonly host: MeetingsHost) {}

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

  private view(job: SavedJob): MeetingJob {
    const completed = this.completed.get(job.id)
    if (completed) return completed
    if (job.state === 'creating' && job.owner !== this.owner) {
      return {
        id: job.id,
        state: job.saving ? 'uncertain' : 'failed',
        message: job.saving
          ? 'Sky restarted during creation. Check Google Calendar before scheduling this meeting again.'
          : 'Sky restarted before the meeting was saved. You can try again.',
      }
    }
    const { id, state, message, result } = job
    return { id, state, message, result }
  }

  async get(id: string): Promise<MeetingJob | null> {
    const job = await this.read(id)
    return job ? this.view(job) : null
  }

  async start(id: string, fields: MeetingFields, reviewKey: string): Promise<MeetingJob> {
    await mkdir(this.host.dir, { recursive: true })
    const job: SavedJob = { id, fields, reviewKey, state: 'creating', saving: false, owner: this.owner }
    try {
      // Exclusive creation serializes repeated clicks, network retries, and competing requests.
      await this.save(job, true)
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      const previous = await this.read(id)
      if (!previous || JSON.stringify(previous.fields) !== JSON.stringify(fields))
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
    const release = hold('creating a meeting')
    const save = () => this.save(job)
    try {
      const beforeSave = async () => {
        const available = await this.host.availability(job.fields)
        if (available.reviewKey !== job.reviewKey)
          throw new Error('Your calendar changed. Review the updated conflicts before creating this meeting.')
      }
      await beforeSave()
      job.result = await this.host.create(job.fields, {
        beforeSave,
        saving: async () => {
          job.saving = true
          await save()
        },
      })
      job.state = 'created'
    } catch (error) {
      job.state = job.saving ? 'uncertain' : 'failed'
      job.message = job.saving
        ? 'Creation could not be confirmed. Check Google Calendar before scheduling this meeting again.'
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
