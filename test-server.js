const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Hello');
});

server.listen(8080, () => {
  console.log('Test server listening on port 8080');
});
