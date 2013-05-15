var _ = require('underscore')
  , S = require('string')
  , sutil = require('./util')


module.exports = function(res) {
  
}

//prepare a data object for view/template rendering
module.exports.initViewData = function(skyEnv) {
  var data = {S: S, _: _, sky: sutil.deepClone(skyEnv.configs.config), self: {}, cache: false}
  data.sky.homepage = 'https://github.com/skywrite'
  return data
}