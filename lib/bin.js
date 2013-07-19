'use strict'

var cl = require('cl')
  , skyenv = require('sky-env')
  , sky = require('./sky')
  , fs = require('fs-extra')

module.exports.initSync = function() {
  var baseDir = sky.findBaseDirSync()
  if (!baseDir) 
    cl.exit(100,"Can't find the sky/config.json. Are you sure you're in a Sky site?")

  var skyEnv = skyenv(baseDir)
  skyEnv.loadConfigsSync()
  
  var configs = skyEnv.configs//sky.loadConfigsSync(_baseDir)
  if (configs.errors['config']) 
    cl.exit(101, 'Could not parse sky/config.json. Is there an error in the JSON?')

  if (!fs.existsSync(skyEnv.themeDir)) 
    cl.exit(102, 'Could not find theme. %s does not exist.', skyEnv.themeDir)

  return skyEnv
}