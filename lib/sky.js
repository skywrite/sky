
module.exports.findBaseDir = findBaseDir
module.exports.loadConfigs = loadConfigs

var pp = require('parentpath')
  , jsoncfg = require('jsoncfg')
  , path = require('path') 

function findBaseDir (callback) {
  pp('sky/config.json', callback)
}

function loadConfigs (baseDir) {
  var dirs = ['./', './sky']
    , configs = {}

  dirs.forEach(function(dir) {
    var cfgs = jsoncfg.loadFilesSync(path.join(baseDir, dir))
    configs = extend(configs, cfgs)
  })

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

