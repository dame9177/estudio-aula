// The only bridge between the page and Node. Keep it a thin list of IPC calls.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  info: call('app:info'),
  pendingPdf: call('app:pending-pdf'),
  onOpenPdf: (fn) => ipcRenderer.on('open-pdf', (_e, p) => fn(p)),
  getPrefs: call('prefs:get'),
  setPrefs: call('prefs:set'),
  choosePdf: call('pdf:choose'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openProject: call('project:open'),
  recentProjects: call('project:recent'),
  setPageCount: call('project:set-page-count'),
  setCameraHidden: call('project:camera-hidden'),
  takeUrl: call('take:url'),
  deleteTake: call('take:delete'),
  beginTake: call('take:begin'),
  takeChunk: call('take:chunk'),
  finishTake: call('take:finish'),
  abortTake: call('take:abort'),
  exportPlan: call('export:plan'),
  startExport: call('export:start'),
  cancelExport: call('export:cancel'),
  onExportProgress: (fn) => {
    const handler = (_e, p) => fn(p);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },
  openPath: call('shell:open'),
  showInFolder: call('shell:show'),
});
