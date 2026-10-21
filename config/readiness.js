// Report only availability; never expose connection details or credentials.
function createReadinessHandler(connection, storageReady) {
	return (_req, res) => {
		const ready = connection.readyState === 1 && storageReady();
		res.setHeader('Cache-Control', 'no-store');
		return res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
	};
}
module.exports = { createReadinessHandler };
