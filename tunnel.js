const localtunnel = require('localtunnel');

(async () => {
  const tunnel = await localtunnel({ 
    port: 3000,
    subdomain: 'watchlist' // tries to get this subdomain
  });

  console.log('\n🌐 Watchlist is now LIVE on the internet!');
  console.log(`\n   Public URL: ${tunnel.url}`);
  console.log(`\n   Share this link with anyone to stream/download movies.`);
  console.log(`   (Keep this terminal open to maintain the connection)\n`);

  tunnel.on('close', () => {
    console.log('\n🔌 Tunnel closed. Run again to get a new public URL.');
    process.exit();
  });

  tunnel.on('error', (err) => {
    console.error('Tunnel error:', err);
  });
})();
