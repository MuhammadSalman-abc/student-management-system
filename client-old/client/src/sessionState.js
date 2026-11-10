// In-memory UI state only; the HttpOnly server cookie is the credential.
let authenticated = false;

export const getSessionMarker = () => authenticated ? "yes" : null;
export const setSessionActive = (value) => { authenticated = Boolean(value); };
