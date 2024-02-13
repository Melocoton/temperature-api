import Fastify from 'fastify';
const fastify = Fastify({logger: true});

fastify.get('/', (request, reply) => {
    reply.send('Hello World');
});

fastify.listen({port: 9001, host: '::'}, (err, address) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});
