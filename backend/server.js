const http = require('http');
const { createApp } = require('./src/app');
const { createOssProfileStore } = require('./src/oss-profile-store');
const { createOssAssetStore } = require('./src/oss-asset-store');

const PORT = Number(process.env.PORT || 9000);

const app = createApp({
  storeFactory: req => createOssProfileStore({ req }),
  assetStoreFactory: req => createOssAssetStore({ req })
});

const server = http.createServer(app);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Shine backend listening on ${PORT}`);
  });
}

module.exports = { app, server };
