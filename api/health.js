module.exports = function (req, res) {
    res.status(200).json({
        status: "ok",
        time: new Date().toISOString(),
        node: process.version,
        env: process.env.VERCEL ? "vercel" : "local"
    });
};
