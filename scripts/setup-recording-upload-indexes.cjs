// Explicit operator action only. Never imported by server startup.
// No URI argument or dotenv loading: use already authorized environment settings.
const mongoose = require('mongoose');
const { uploadIndexes } = require('../services/uploadIdempotency');
async function main() {
  if (process.argv[2] !== '--apply-test-only') throw Error('Requires explicit --apply-test-only approval. Read RECORDING_UPLOAD_ROLLOUT.md first.');
  if (!process.env.MONGO_URI) throw Error('MONGO_URI must be supplied through the authorized environment.');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  try {
    if (mongoose.connection.name !== 'travel_test') throw Error('Refusing any database other than travel_test.');
    for (const [collectionName, definition] of [['trips', uploadIndexes.trip], ['recommendations', uploadIndexes.recommendation]]) {
      const { key, ...options } = definition;
      await mongoose.connection.db.collection(collectionName).createIndex(key, options);
      console.log(`Verified ${collectionName}: ${definition.name}`);
    }
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
