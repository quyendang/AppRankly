let active = 0;
const queue = [];
async function limited(task) {
  if (active >= 2) await new Promise((resolve) => queue.push(resolve));
  else active++;
  try {
    return await task();
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
module.exports = { limited };
