var spawn = require('win-fork')
  , P = require('autoresolve')
  , colors = require('colors')


var SKY_BIN = P('bin/sky')

function runSky () {
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
  if (!skipEvents) {
    sky.stdout.on('data', function(data) {
      //console.log('FO: ' + colors.cyan(data))
      stdout += data.toString()
    }) 
    sky.stderr.on('data', function(data) {
      //console.log('FE: ' + colors.red(data))
      stderr += stderr.toString()
    })
    sky.on('exit', function(code) {
      callback(code, stdout, stderr)
    })
  }

  return sky
}

module.exports.runSky = runSky