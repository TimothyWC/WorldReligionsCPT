#!/usr/bin/env node
/* Inlines src/ into two single-file builds:
     dist/phosphor.html  standalone page (open it directly, or host it anywhere)
     dist/artifact.html  same content without the document shell, for publishing as an artifact */
'use strict';
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

// --no-editor leaves the level editor out; --out=<dir> writes somewhere other than dist/
const noEditor = process.argv.includes('--no-editor');
const outArg = process.argv.find(a => a.startsWith('--out='));
const order = ['engine.js', 'extras.js', 'levels.js', 'demos.js', 'solver.js', 'audio.js', 'render.js', 'game.js', 'editor.js'].filter(f => !(noEditor && f === 'editor.js'));
const scripts = order
  .filter(f => fs.existsSync(path.join(__dirname, 'src', f)))
  .map(f => '<script>\n' + src(f).replace(/<\/script/gi, '<\\/script') + '\n</script>')
  .join('\n');

const editorHtml = !noEditor && fs.existsSync(path.join(__dirname, 'src', 'editor.html')) ? src('editor.html') : '';
const page = src('page.html').replace('<!--EDITOR-->', editorHtml).replace('<!--SCRIPTS-->', scripts);
const out = outArg ? path.resolve(outArg.slice(6)) : path.join(__dirname, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'artifact.html'), page);
fs.writeFileSync(path.join(out, 'phosphor.html'),
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' +
  '<meta name="theme-color" content="#04110c">\n' +
  '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}[hidden]{display:none!important}</style>\n' +
  '</head>\n<body>\n' + page + '\n</body>\n</html>\n');
console.log('built ' + path.relative(process.cwd(), out) + '/phosphor.html and artifact.html (' + (page.length / 1024).toFixed(0) + ' KB)');
