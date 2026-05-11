export class YoutubeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class QuotaExceededError extends YoutubeError {
  constructor(
    readonly used: number,
    readonly requested: number,
  ) {
    super(
      `YouTube daily soft cap exceeded: used=${used} requested=${requested}`,
    );
  }
}

export class InvalidChannelError extends YoutubeError {
  constructor(readonly input: string) {
    super(`Invalid YouTube URL: ${input.slice(0, 100)}`);
  }
}

export class UpstreamError extends YoutubeError {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}
