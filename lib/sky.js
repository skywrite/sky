
module.exports.findBaseDir = findBaseDir
module.exports.loadConfigsSync = loadConfigsSync

var pp = require('parentpath')
  , jsoncfg = require('jsoncfg')
  , path = require('path') 

function findBaseDir (callback) {
  pp('sky/config.json', callback)
}

function loadConfigsSync (baseDir) {
  var dirs = ['./', './sky']
    , configs = {}
    , errors = {}

  dirs.forEach(function(dir) {
    var cfgs = jsoncfg.loadFilesSync(path.join(baseDir, dir))
    errors = extend(errors, cfgs.errors)
    configs = extend(configs, cfgs)
  })

  configs.errors = errors
  return configs
}

/*
 private methods */

function extend (obj1, obj2) {
  Object.keys(obj2).forEach(function(key) {
    obj1[key] = obj2[key]
  })
  return obj1
}

