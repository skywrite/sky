var sorto = require('sorto')

var me = module.exports

me.maxTagLen = function (tags) {
  var max = -1
  if (typeof tags[0] == 'string') {
    max = tags.reduce(function(val, cur) {
      return val > cur.length ? val : cur.length
    }, tags[0].length)
  } else {
    max = tags.reduce(function(val, cur) {
      return val > sorto.k(cur).length ? val : sorto.k(cur).length
    }, sorto.k(tags[0]).length)
  }

  return max
}

me.tagCount = function(countObj, arr) {
  arr.forEach(function(tag) {
    countObj[tag] ? countObj[tag] += 1 : countObj[tag] = 1   
  })
}