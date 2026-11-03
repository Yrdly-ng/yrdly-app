export class EventFinanceError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}
