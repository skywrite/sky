var spawn = require('win-spawn')
  , P = require('autoresolve')
  , colors = require('colors')
  , path = require('path')

require('shelljs/global')

var SKY_BIN = P('bin/sky')

var me = module.exports

me.runSky = function () {
  var args = Array.prototype.slice.call(arguments, 0)
    , stdout = ''
    , stderr = ''
    , callback = args[args.length-1]
    , skipEvents = false

  //used when you need to terminate child proc, see sky-serve.test.js
  if (args[args.length - 1].toString() === 'true') skipEvents = true
  
  args.splice(args.length - 1, 1) //cut callback

  //console.dir(args)

  if (args[0] === 'new' && args[2] === 'personal-blog') {
    args[2] = P('test/resources/personal-blog') //inject testing rock
  }

  var sky = spawn(SKY_BIN, args)
  var prog = path.basename(SKY_BIN + '-' + args[0])
  if (!skipEvents) {
    sky.stdout.on('data', function(data) {
      process.stdout.write(prog + ': ' + colors.cyan(data))
      stdout += data.toString()
    }) 
    sky.stderr.on('data', function(data) {
      process.stderr.write(prog + ': ' + colors.red(data))
      stderr += stderr.toString()
    })
    sky.on('exit', function(code) {
      callback(code, stdout, stderr)
    })
  }

  return sky
}

me.runSkySync = function (/* args */) {
  var args = [].slice.call(arguments)

  if (args[0] === 'new' && args[2] === 'personal-blog') {
    args[2] = P('test/resources/personal-blog') //inject testing rock
  }

  var prog = path.basename(SKY_BIN + '-' + args[0])
  var res = exec(SKY_BIN + ' ' + args.join(' '), {silent: true})
  process.stdout.write(prog + ': ' + colors.cyan(res.output))

  if (res.code !== 0)
    process.stderr.write(prog + ': ' + colors.red("returned " + res.code))

  return res
}

