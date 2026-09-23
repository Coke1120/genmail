// Desktop origins use a fresh port each launch; durable state lives in its user profile.
export const storage = {
  getItem: key => window.morrowDesktop ? window.morrowDesktop.readState(key) : localStorage.getItem(key),
  setItem: (key, value) => window.morrowDesktop ? window.morrowDesktop.writeState(key, value) : localStorage.setItem(key, value),
  removeItem: key => window.morrowDesktop ? window.morrowDesktop.removeState(key) : localStorage.removeItem(key),
};
