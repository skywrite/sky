'use strict'

var cl = require('cl')
  , SkyEnv = require('./sky_env').SkyEnv
  , sky = require('./sky')

module.exports.initSync = function() {
  var baseDir = sky.findBaseDirSync()
  if (!baseDir) 
    cl.exit(100,"Can't find the sky/config.json. Are you sure you're in a Sky site?")

  var skyEnv = new SkyEnv(baseDir)
  skyEnv.loadConfigsSync()
  
  var configs = skyEnv.configs//sky.loadConfigsSync(_baseDir)
  if (configs.errors['config']) 
    cl.exit(101, 'Could not parse sky/config.json. Is there an error in the JSON?')

  return skyEnv
}