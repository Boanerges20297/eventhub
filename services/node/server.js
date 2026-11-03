'use strict';

const Fastify = require('fastify');

const service = process.env.SERVICE_NAME || 'undefined';
const allowed = new Set(['identity', 'events', 'payments', 'gateway']);
if (!allowed.has(service)) {
  process.stderr.write('SERVICE_NAME invalido\n');
  process.exit(1);
}
const server = Fastify({ logger: true, bodyLimit: 1024 * 1024, trustProxy: false });

server.get('/health', async () => ({
  status: 'up',
  service,
  implementation: 'scaffold',
  business_ready: false
}));

// Gateway publico: recursos de negocio ainda nao foram autorizados como prontos.
// Nao expor CRUD sem JWT, CSRF e autorizacao por objeto.
if (service === 'gateway') {
  server.get('/status', async () => ({
    stage: 'infrastructure-only',
    explanation: 'Servicos iniciados, contratos de negocio ainda em implementacao'
  }));
  server.setNotFoundHandler((_request, reply) => {
    reply.code(501).send({
      error: 'ENDPOINT_NAO_IMPLEMENTADO',
      message: 'Recurso depende de JWT, ownership e contrato da API'
    });
  });
}

const port = Number(process.env.PORT || 3000);
server.listen({ port, host: '0.0.0.0' })
  .catch((error) => {
    server.log.error(error);
    process.exit(1);
  });
