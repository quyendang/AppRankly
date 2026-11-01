function createLimiter(maximum = 2) {
  let active = 0;
  const queue = [];
  return async function limited(task) {
    if (active >= maximum) await new Promise((resolve) => queue.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
module.exports = { limited: createLimiter(2), createLimiter };
