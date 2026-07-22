try {
  const app = require('../backend/server');
  module.exports = app;
} catch (err) {
  module.exports = (req, res) => {
    res.status(500).json({ error: 'Failed to load server', message: err.message });
  };
}
