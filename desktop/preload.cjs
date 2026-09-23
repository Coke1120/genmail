const { contextBridge, ipcRenderer } = require('electron');
function state(operation, key, value) {
  const result = ipcRenderer.sendSync('morrow:state', operation, key, value);
  if (result.error) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('morrowDesktop', {
  readState: key => state('get', key),
  writeState: (key, value) => state('set', key, value),
  removeState: key => state('remove', key),
  openSignIn: url => ipcRenderer.invoke('morrow:sign-in', url),
});
