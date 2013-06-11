'use strict'

var _ = require('underscore')
  , S = require('string')
  , sutil = require('./util')
  , dt = require('date-tokens')
  /* for exporting to view if view wants 'em */
  , fs = require('fs-extra')
  , path = require('path')
  , os = require('os')
  , querystring = require('querystring')
  , url = require('url')
  , util = require('util')
  , viewfn = require('./viewfn')

module.exports = function(viewData, res) {
  var mdp = res.document
    , file = res.file
    , stat = res.stat
    , skyEnv = viewData.skyEnv
    , configs = skyEnv.configs
  
  viewData.ctx = {}
  viewData.ctx.title = mdp.title || mdp.metadata.title
  viewData.ctx.content = mdp.html

  viewData.ctx = _(viewData.ctx).extend(mdp.metadata)
  viewData.ctx.createdAt = stat.ctime
  viewData.ctx.modifiedAt = stat.mtime
  viewData.ctx.publishedAt = new Date(viewData.ctx.publish)
  viewData.ctx.slug = viewData.ctx.slug || S(viewData.ctx.title).slugify()
  viewData.ctx.author = viewData.ctx.author || (configs.get('config:site.author'))

  //console.log("md; %s", mdp.metadata.publish.toString().magenta.bold)
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
  viewData.node = {
    fs: fs,
    os: os,
    path: path,
    querystring: querystring,
    url: url,
    util: util
  }

  viewData.fn = viewfn(skyEnv, viewData)

  return viewData
}