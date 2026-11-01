export function trendSeries(apps, previous = [], range) {
  const actual = [
    ...new Set(
      apps.flatMap((app) => (app.dailyTrends || []).map((day) => day.date)),
    ),
  ].sort();
  const start = range?.startDate || actual[0],
    end = range?.endDate || actual.at(-1);
  if (!start || !end) return { dates: [], values: [], old: [] };
  const dates = [];
  for (
    let time = Date.parse(start);
    time <= Date.parse(end) && dates.length < 366;
    time += 86400000
  )
    dates.push(new Date(time).toISOString().slice(0, 10));
  const sum = (list, date) => {
    const known = list
      .map((app) => app.dailyTrends?.find((day) => day.date === date)?.installs)
      .filter(Number.isFinite);
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  };
  return {
    dates,
    values: dates.map((date) => sum(apps, date)),
    old: dates.map((date) =>
      sum(
        previous,
        new Date(Date.parse(date) - dates.length * 86400000)
          .toISOString()
          .slice(0, 10),
      ),
    ),
  };
}
export function sparkSegments(values, max) {
  const segments = [];
  let current = [];
  values.forEach((value, index) => {
    if (Number.isFinite(value))
      current.push(
        `${(index * 150) / Math.max(values.length - 1, 1)},${35 - (value * 31) / Math.max(max, 1)}`,
      );
    else if (current.length) {
      segments.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) segments.push(current.join(" "));
  return segments;
}
