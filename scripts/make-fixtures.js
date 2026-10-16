// Builds the demo lesson PDF and the fake-camera avatar used by the e2e test and screenshots.
// Run: npx electron scripts/make-fixtures.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, '..', 'tests', 'fixtures');

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1280, height: 720, show: false });
  await w.loadFile(path.join(FIX, 'aula-exemplo.html'));
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  const pdf = await w.webContents.printToPDF({
    pageSize: { width: 1280 / 96, height: 720 / 96 },
    margins: { marginType: 'none' },
    printBackground: true,
    preferCSSPageSize: true,
  });
  fs.writeFileSync(path.join(FIX, 'Como gravar uma videoaula.pdf'), pdf);

  const svg = fs.readFileSync(path.join(FIX, 'avatar.svg'), 'utf8');
  const a = new BrowserWindow({ width: 640, height: 640, show: false, useContentSize: true });
  await a.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>body{margin:0}svg{display:block}</style>${svg}`)}`);
  await new Promise((r) => setTimeout(r, 200));
  const img = await a.webContents.capturePage({ x: 0, y: 0, width: 640, height: 640 });
  fs.writeFileSync(path.join(FIX, 'avatar.png'), img.resize({ width: 640, height: 640 }).toPNG());
  app.quit();
});
