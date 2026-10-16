// Renders packaging/estudio-aula.svg to a 512px PNG (window + menu icon). Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const svg = path.join(__dirname, '..', 'packaging', 'estudio-aula.svg');
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true });
  const markup = fs.readFileSync(svg, 'utf8').replace('<svg ', '<svg width="512" height="512" ');
  const html = `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`;
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, '..', 'packaging', 'estudio-aula.png'), img.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});
