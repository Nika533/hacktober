export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export function createLogger(scope: string): Logger {
  const tag = `[hoot:${scope}]`
  return {
    info: (msg) => console.info(`${tag} ${msg}`),
    warn: (msg) => console.warn(`${tag} ${msg}`),
    error: (msg) => console.error(`${tag} ${msg}`)
  }
}
