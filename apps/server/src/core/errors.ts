/** The one refusal type. `code` is what the client keys on (never the message). */
export class EngineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
