'use strict'

var _ = require('underscore')
  , S = require('string')
  , sutil = require('./util')
  , dt = require('date-tokens')


module.exports = function(viewData, res) {
  var mdp = res.document
    , file = res.file
    , stat = res.stat
    , skyEnv = viewData.skyEnv
    , configs = skyEnv.configs
  
  viewData.self = {title: mdp.title, content: mdp.html}

  viewData.self = _(viewData.self).extend(mdp.metadata)
  viewData.self.createdAt = stat.ctime
  viewData.self.modifiedAt = stat.mtime
  viewData.self.publishedAt = new Date(viewData.self.publish)
  viewData.self.slug = viewData.self.slug || S(mdp.title).slugify()
  viewData.self.author = viewData.self.author || (configs.get('config:blog.author'))

  viewData.self = _(viewData.self).extend(dt.eval(mdp.metadata.publish, 'date-')) //add date-tokens

  var relOutFile = skyEnv.mdArticleToOutputFile(file, viewData.self) 

  viewData.self.relativePath = relOutFile

  //for nice urls in github pages
  if (S(viewData.self.relativePath).endsWith('index.html'))
    viewData.self.relativePath = viewData.self.relativePath.replace('index.html', '')

  return viewData
}

//prepare a data object for view/template rendering
module.exports.initViewData = function(skyEnv) {
  var viewData = {S: S, _: _, sky: sutil.deepClone(skyEnv.configs.config), self: {}, skyEnv: skyEnv, cache: false}
  viewData.sky.homepage = 'https://github.com/skywrite'
  return viewData
}