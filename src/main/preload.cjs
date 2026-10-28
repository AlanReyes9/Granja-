const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  call: (method, ...args) => ipcRenderer.invoke('call', method, args),
  on: (handler) => {
    const fn = (_e, msg) => handler(msg);
    ipcRenderer.on('event', fn);
    return () => ipcRenderer.removeListener('event', fn);
  },
  // Paquetes de vídeo en tiempo real (H.264) de los teléfonos.
  onStream: (handler) => {
    const fn = (_e, packet) => handler(packet);
    ipcRenderer.on('stream', fn);
    return () => ipcRenderer.removeListener('stream', fn);
  },
  // Ruta real de un archivo arrastrado a la ventana.
  pathForFile: (file) => webUtils.getPathForFile(file),
});
