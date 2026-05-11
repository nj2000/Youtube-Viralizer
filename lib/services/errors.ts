export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MissingDependencyError extends PipelineError {
  constructor(
    readonly stage: string,
    readonly missing: string[],
  ) {
    super(`Stage "${stage}" is missing inputs: ${missing.join(", ")}`);
  }
}

export class StageNotImplementedError extends PipelineError {
  constructor(readonly stage: string) {
    super(`No handler registered for stage "${stage}"`);
  }
}

export class GateFailedError extends PipelineError {
  constructor(readonly score: number) {
    super(`Idea score ${score} is below the 92 viral gate threshold`);
  }
}

export class RunNotFoundError extends PipelineError {
  constructor(
    readonly runId: string,
    readonly userId: string,
  ) {
    super(`pipeline_runs row not found: id=${runId} user=${userId}`);
  }
}
