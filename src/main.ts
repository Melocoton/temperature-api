import Fastify from 'fastify';
import sqlite3 from "sqlite3";
import 'dotenv/config'

type Row = { id: number, time: number, temperature: number, humidity: number };
type Response = { id: string, time: Date, temperature: number, humidity: number }

const fastify = Fastify({logger: true});
const db = new sqlite3.Database(process.env.DB_LOCATION,sqlite3.OPEN_READONLY, err => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
});

fastify.get('/', (request, reply) => {
    reply.send('Hello World');
});

fastify.get('/current', (request, reply) => {
    db.all('SELECT DISTINCT(id), max(time) AS time, temperature, humidity FROM temperature GROUP BY id;', (err, rows: Row[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            const transformed = rows.map(transformRow);
            reply.send({result: transformed});
        }
    });
});

fastify.listen({port: 9001, host: '::'}, (err, address) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});

function transformRow(row: Row): Response {
    return {
        humidity: row.humidity,
        id: row.id.toString(16).toUpperCase().padStart(12, '0').match(/.{1,2}/g).join(':'),
        temperature: row.temperature,
        time: new Date(row.time)
    }
}
