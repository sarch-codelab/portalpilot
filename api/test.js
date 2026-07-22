module.exports = (req, res) => {
  res.status(200).json({ status: 'ok', test: true, timestamp: new Date().toISOString() });
};
