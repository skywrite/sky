/************
 * This will eventually be refactored out into a plugin.
 ***********/

var _ = require('underscore')
  , RSS = require('rss')


module.exports = function rss (configs, outputArticles) {
  //generate RSS
  var articles = []
  Object.keys(outputArticles).forEach(function(file) {
    articles.push(outputArticles[file])
  })
  articles = _(articles).chain().sortBy(function(a) {
    //console.log(new Date(a.publishedAt).toISOString() + ' : ' + a.title)
    return -a.publishedAt
  }).take(10).value()

  var feed = new RSS({
    title: configs.get('config:blog.name'),
    description: configs.get('config:blog.tagline'),
    feed_url: configs.get('config:blog.url') + '/rss.xml',
    site_url: configs.get('config:blog.url'),
    //image_url: 'http://example.com/icon.png',
    author: configs.get('config:blog.author')
  });

  articles.forEach(function(a) {
    feed.item({
      title:  a.title,
      description: a.content,
      url: configs.get('config:blog.url') + '/' + a.relativePath, // link to the item
      //guid: '1123', // optional - defaults to url
      author: a.author,
      date: a.publish
    });
  })
  
  // cache the xml
  var xml = feed.xml()
  return xml
}