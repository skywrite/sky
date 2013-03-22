var testutil = require('testutil')
  , fs = require('fs-extra')
  , P = require('autoresolve')
  , libsky  = require(P('lib/sky'))
  , path = require('path')

var TEST_DIR = null
  , CFG_FILE = null

function removePrivate(dir) {
  if (!dir) return null

  if (dir.indexOf('/private/tmp') === 0)  //MAC OS X symlinks /tmp to /private/tmp
    dir = dir.replace('/private', '');
  return dir
}

describe.skip('lib/sky', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    CFG_FILE = path.join(TEST_DIR, 'sky', 'config.json')
    fs.outputFileSync(CFG_FILE, '')
  })
})
