// Build a dependency-free copy that opens directly without a local web server.
import { readFile, writeFile } from 'node:fs/promises';
const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const [html, css, engine, app] = await Promise.all([
  read('index.html'), read('style.css'), read('engine.mjs'), read('app.mjs'),
]);
const logic = engine.replace(/^export /gm, '') + '\n' + app.replace(/^import .*;\n/, '');
const result = html
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="app.mjs"></script>', () => `<script>\n'use strict';\n${logic.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await writeFile(new URL('play.html', import.meta.url), result);
console.log('Built prototype/play.html');
