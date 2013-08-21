0.5.0 / 2013-08-20
------------------
* implemented page support. Closes #4

0.4.1 / 2013-08-15
------------------
* themes can now have assets

0.4.0 / 2013-08-15
------------------
* start of theme implementation, `templates` dir in `sky` is gone. Closes #18
* switched from `win-fork` to `win-spawn`
* refactored out `SkyEnv` into its own module named `sky-env`. Closes #15
* removed ability to automatically open newly created article in an editor
* upgraded `markdown-page`, fixes `:` in metadata bug. Closes #20
* if article theme file or layout theme file are modified, rebuilds all articles. Closes #17

0.3.0 / 2013-06-11
------------------
* when creating a new article, the title is now in the metadata. Closes #13
* when creating a new article, put today's date by default as the publish date. Closes #14
* replace highlight.js with Pygments. Closes #1
* Fix empty tag bug. Closes #11

0.2.0 / 2013-05-16
------------------
* fixed bug that outputs unrelated data to sky/config.json
* updated from rock `0.2.0` to `0.3.0`
* working display of tags, `sky tag --help`
* added support for `jade` as well as `ejs`
* made a prettier output when building articles
* building of tag index files
* view now has access to `node` and `fn` functions for richer view
* partial type agnosticism... `html`, `ejs`, or `jade` sky don't care
* Implemented utility to move titles into metadata. Closes #6
* tag renaming utility

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
