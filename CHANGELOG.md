0.1.1 / 2013-04-11
------------------
* when `lastBuild` was used, it didn't output the all of the files for index, only the ones that 
  met the `lastBuild` criteria. Closes #[8](https://github.com/skywrite/sky/issues/8). Closes #[5](https://github.com/skywrite/sky/issues/5)

0.1.0 / 2013-03-22
------------------
* added Travis-CI support
* added Node v0.10 support
* upgraded to `fs-extra` to `v0.6.x`
* upgraded latest `parentpath` to get sync
* created `SkyEnv` class
* fixed bug in `sky-serve`
* only build files if the last modified time on the markdown is greater than the last build time


0.0.9 / 2013-02-25
------------------
* Fixed bug that prevented `sky-build` from fetching the proper output directory.
* Serve command serves from proper output directory.
* Fixed building bug.
* Made some small tweaks for pretty Github page urls.


0.0.8 / 2013-02-25
------------------
* Fixed bug when an article only had one tag.

0.0.7 / 2013-02-07
------------------
* Forgot `nextflow` dep.
* `sky-build` is now using `jsoncfg` and `self` now contains all of the header data from each Markdown file.
* starting to remove lib/cli.js for module `cl`.
* Changed template / index format a bit. 
* Added RSS feed generator.


0.0.6 / 2013-02-07
-------------------
* First usable release under the new name.
* A lot has changed since it was named `potter`.


0.0.5 / 2013-01-24
------------------
* Renamed `Potter` to `Sky` because I didn't like that the Node.js package name `potter` was taken. I was using `pottercms`.
