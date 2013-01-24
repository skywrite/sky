var spawn = require('win-fork')
  , P = require('autoresolve')

var SKY_BIN = P('bin/sky')

function runSky () {
  var args = Array.prototype.slice.call(arguments, 0)
    , stdout = ''
    , stderr = ''
    , callback = args[args.length-1]

  args.splice(args.length - 1, 1) //cut callback

  var sky = spawn(SKY_BIN, args)
  sky.stdout.on('data', function(data) {
    stdout += data.toString()
  }) 
  sky.stderr.on('data', function(data) {
    stderr += stderr.toString()
  })
  sky.on('exit', function(code) {
    callback(code, stdout, stderr)
  })
}

module.exports.runSky = runSky