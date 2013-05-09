var me = module.exports

me.deepClone = function(obj) {
  //pooo man's clone
  return JSON.parse(JSON.stringify(obj))
}