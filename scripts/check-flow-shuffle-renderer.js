// Execute production selection, activation, receipts and journal normalization.
const { runFlow } = require('./check-shuffle-windows-w0');
runFlow().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
