// Unconfigured builds retain the combined Google Cloud deployment behavior.
export const backendOrigin = import.meta.env?.VITE_BACKEND_URL?.trim().replace(/\/+$/, '') || '';
export const backendPath = (path: string): string => `${backendOrigin}${path}`;
