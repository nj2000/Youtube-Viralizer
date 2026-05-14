export type MedianResult = {
  median: number | null;
  isNewChannel: boolean;
  lowCadence: boolean;
};

const LOW_CADENCE_THRESHOLD = 10;

export function computeMedianViews(views: number[]): MedianResult {
  if (views.length === 0) {
    return { median: null, isNewChannel: true, lowCadence: false };
  }

  if (views.length < LOW_CADENCE_THRESHOLD) {
    const sum = views.reduce((acc, v) => acc + v, 0);
    return {
      median: Math.round(sum / views.length),
      isNewChannel: false,
      lowCadence: true,
    };
  }

  const sorted = [...views].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);

  return { median, isNewChannel: false, lowCadence: false };
}
