/** Names the server accepts: capital letters, digits and _ (plugin env_keys.NAME). */
export const ENV_KEY_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
/** Longest value the server accepts (plugin env_keys.MAX_VALUE). */
export const ENV_KEY_MAX_VALUE = 8192;
