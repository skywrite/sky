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
  
  viewData.ctx = {title: mdp.title, content: mdp.html}

  viewData.ctx = _(viewData.ctx).extend(mdp.metadata)
  viewData.ctx.createdAt = stat.ctime
  viewData.ctx.modifiedAt = stat.mtime
  viewData.ctx.publishedAt = new Date(viewData.ctx.publish)
  viewData.ctx.slug = viewData.ctx.slug || S(mdp.title).slugify()
  viewData.ctx.author = viewData.ctx.author || (configs.get('config:blog.author'))

  viewData.ctx = _(viewData.ctx).extend(dt.eval(mdp.metadata.publish, 'date-')) //add date-tokens

  var relOutFile = skyEnv.mdArticleToOutputFile(file, viewData.ctx) 

  viewData.ctx.relativePath = relOutFile

  //for nice urls in github pages
  if (S(viewData.ctx.relativePath).endsWith('index.html'))
    viewData.ctx.relativePath = viewData.ctx.relativePath.replace('index.html', '')

  return viewData
}

//prepare a data object for view/template rendering
module.exports.initViewData = function(skyEnv) {
  var viewData = {S: S, _: _, sky: sutil.deepClone(skyEnv.configs.config), ctx: {}, skyEnv: skyEnv, cache: false, pretty: true}
  viewData.sky.homepage = 'https://github.com/skywrite'
  return viewData
}