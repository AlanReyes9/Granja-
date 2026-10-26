const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('granja', {
  call: (method, ...args) => ipcRenderer.invoke('call', method, args),
  on: (handler) => {
    const fn = (_e, msg) => handler(msg);
    ipcRenderer.on('event', fn);
    return () => ipcRenderer.removeListener('event', fn);
  },
  // Ruta real de un archivo arrastrado a la ventana.
  pathForFile: (file) => webUtils.getPathForFile(file),
});
