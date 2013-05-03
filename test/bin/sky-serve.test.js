var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , S = require('string')
  , runSky = require(P('test/test-lib/testsky')).runSky
  , rock = require('rock')
  , scrap = require('scrap')

var TEST_DIR = ''

function removePrivate (dir) {
  //mac os x symlinks /tmp to /private/tmp
  if (S(dir).startsWith('/private'))
    dir = dir.replace('/private', '')
  return dir
}

describe('bin/', function() {
  beforeEach(function(done) {
    TEST_DIR = testutil.createTestDir('sky')
    TEST_DIR = path.join(TEST_DIR, 'serve')
    if (!fs.existsSync(TEST_DIR)) fs.mkdirsSync(TEST_DIR)
    process.chdir(TEST_DIR)

    rock.fetchRepo(TEST_DIR, P('test/resources/faux-rock'), function(err) {
      if (err) done(err)

      var htmlFile = path.join(TEST_DIR, 'public', 'index.html')
      fs.outputFileSync(htmlFile, '<h1 class="msg">hello!</h1>')
      done()
    })
  })

  describe('sky-serve', function() {
    describe('> when no parameters are passed and are currently in the base directory', function() {
      it('should serve up the directory', function(done) {
        process.chdir(TEST_DIR)
        var skyProc = runSky('serve', true)
        VERIFY_SERVE(skyProc, 2222, TEST_DIR, done)
      })
    })

    describe('> when the port parameter is passed and is currently in the base directory', function() {
      it('should serve up the directory on the new port', function(done) {
        process.chdir(TEST_DIR)
        var port = 43118
        var dir = TEST_DIR
        var skyProc = runSky('serve', '--port', port, true)
        VERIFY_SERVE(skyProc, port, dir, done)
      })
    })

    describe('> when the port is passed through the environment and is currently in the base directory', function() {
      it('should serve up the directory on the new port', function(done) {
        process.chdir(TEST_DIR)
        var port = 43118
        var dir = TEST_DIR
        process.env.PORT = port
        var skyProc = runSky('serve', true)
        VERIFY_SERVE(skyProc, port, dir, done)
      })
    })

    describe('> when the current directory is different than the base directory', function() {
      it('should locate the base directory and serve it up', function(done) {
        var demoDir = path.join(TEST_DIR, 'articles', '2013')
        fs.mkdirsSync(demoDir)
        process.chdir(demoDir)
        var skyProc = runSky('serve', true)
        VERIFY_SERVE(skyProc, 2222, demoDir, done)
      })
    })

    describe('> when the current directory is different than the base directory and the directory is specified', function() {
      it('should serve it up from the specified directory', function(done) {
        process.chdir('/tmp')
        var skyProc = runSky('serve', '--dir', path.join(TEST_DIR, 'public'), true)
        VERIFY_SERVE(skyProc, 2222, '/tmp', done)
      })
    })
  })
})

function VERIFY_SERVE (sky, port, dir, done) { //dir param not really necessary
  var stdout = ''
    , stderr = ''

  sky.stdout.on('data', function(data) {
    //console.log('' + data)
    stdout += data
  }) 
  sky.stderr.on('data', function(data) {
    stderr += data
  })
  sky.on('exit', function(code) {
    if (code !== 0) done(new Error('Exit code: ' + code + ' \n\nSTDOUT:\n' + stdout + '\n\nSTDERR:\n' + stderr))
  })

  setTimeout(function() {
    T (S(stdout).startsWith("Serving up"))
    var expectedServeDir = stdout.replace('Serving up', '').replace('on port', '').replace(port.toString(), '').replace('...', '').trim()
    expectedServeDir = removePrivate(expectedServeDir)
    EQ (path.resolve(path.join(TEST_DIR, 'public')), expectedServeDir)
    scrap("http://localhost:" + port + '/index.html', function(err, $, code, body) {
      sky.removeAllListeners('exit') //if we dont do this, it fires done error
      sky.kill()
      EQ ($('.msg').text(), 'hello!')

      delete process.env.PORT //reset for next test
      done()
    }) 
  },500)
  
}





