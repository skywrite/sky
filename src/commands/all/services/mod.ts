import colors from 'picocolors'
import * as stringSimilarity from 'string-similarity'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as services from '#lib/services/mod.ts'

const params = {
  service: Arg.string('The service name', { optional: true }),
  start: Flag.bool('Start a service', { default: false }),
  stop: Flag.bool('Stop a service', { default: false }),
  load: Flag.bool('Load a service', { default: false }),
  unload: Flag.bool('Unload a service', { default: false }),
  reload: Flag.bool('Unload a service, then load it', { default: false }),
  restart: Flag.bool('Stop a service, then start it', { default: false }),
}

type Params = InferParams<typeof params>

export default class ServicesRunTask extends Command {
  static override description: CommandDescription = {
    name: 'services',
    description: 'List, start, stop a service.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { service, start, stop, load, unload, reload, restart } = args

    // with no service name, we list all
    // local notebook services
    if (!service) {
      const s = await services.localServicesStatus()
      output.table(s)
      return CommandResult.success(s)
    }

    const haveOneFlag = start || stop || load || unload || reload || restart
    if (!haveOneFlag) {
      output.error('\n  If you pass a service name, you must pass a flag.\n')
      return CommandResult.fail('If you pass a service name, you must pass a flag.')
    }

    const serviceExists = await services.doesServiceExistAndInstalled(service)
    if (!serviceExists) {
      const cleanService = services.resolveService(service).shortLabel
      const servicesInfo = await services.localServicesStatus()

      const serviceShortLabels = servicesInfo.map((svc) => services.resolveService(svc.label).shortLabel)
      const { bestMatch } = stringSimilarity.findBestMatch(cleanService, serviceShortLabels)

      let errMessage = `\n  Service ${colors.redBright(cleanService)} does not exist.\n`
      if (bestMatch) {
        errMessage += `\n  Did you mean ${colors.cyanBright(bestMatch.target)}?\n`
      }

      output.error(errMessage)
      return CommandResult.fail(`Service ${cleanService} does not exist.`)
    }

    let result
    try {
      if (start) {
        result = await services.start(service)
        output.log(JSON.stringify(result, null, 2))
      } else if (stop) {
        result = await services.stop(service)
        output.log(JSON.stringify(result, null, 2))
      } else if (load) {
        result = await services.load(service)
        output.log(JSON.stringify(result, null, 2))
      } else if (reload) {
        result = await services.reload(service)
        output.log(JSON.stringify(result, null, 2))
      } else if (restart) {
        result = await services.restart(service)
        output.log(JSON.stringify(result, null, 2))
      } else if (unload) {
        result = await services.unload(service)
        output.log(JSON.stringify(result, null, 2))
      } else {
        output.error('\n  Should not get to this point.\n')
        return CommandResult.error('No valid service action specified')
      }
    } catch (err) {
      return CommandResult.error(err as Error, 'Service operation failed')
    }

    return CommandResult.success(result)
  }
}
