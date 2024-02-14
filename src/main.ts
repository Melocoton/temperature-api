import Fastify from 'fastify';
import sqlite3 from "sqlite3";
import 'dotenv/config';

type Record = { id: number, time: number, temperature: number, humidity: number };
type FormattedRecord = { id: number, id_formatted: string, time: Date, temperature: number, humidity: number };
type Device = { id: number, description: string };

const fastify = Fastify({logger: true});
const db = new sqlite3.Database(process.env.DB_LOCATION,sqlite3.OPEN_READWRITE, err => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
});

fastify.get('/', (request, reply) => {
    reply.send('Hello World');
});

fastify.get('/current', (request, reply) => {
    db.all('SELECT DISTINCT(id), max(time) AS time, temperature, humidity FROM temperature GROUP BY id', (err, rows: Record[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(rows.map(transformRow));
        }
    });
});

fastify.get('/current/:id', (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    db.get('SELECT id, max(time) AS time, temperature, humidity FROM temperature GROUP BY id WHERE id = $id', { $id: id }, (err, row: Record) => {
        if (err || !row) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(transformRow(row));
        }
    });
});

fastify.get('/devices', (request, reply) => {
    db.all('SELECT * FROM device;', (err, rows: Device[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(rows);
        }
    });
});

fastify.get('/device/:id', (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    db.get('SELECT * FROM device WHERE id = $id', {
        $id: id,
    }, (err, row: Device) => {
        if (err) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.code(200).send(row);
        }
    });
});

fastify.put('/device', (request, reply) => {
    const device: Device = request.body as Device;
    db.run('INSERT INTO device (id, description) values ($id, $description)', {
        $id: device.id,
        $description: device.description
    }, err => {
        if (err) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            fastify.log.info('Device data added');
            reply.code(201).send();
        }
    });
});

fastify.patch('/device', (request, reply) => {
    const device: Device = request.body as Device;
    db.run('UPDATE device SET description = $description WHERE id = $id', {
        $id: device.id,
        $description: device.description
    }, err => {
        if (err) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            fastify.log.info('Device data updated');
            reply.code(200).send();
        }
    });
});

fastify.delete('/device/:id', (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    db.run('DELETE FROM device WHERE id = $id', {
        $id: id,
    }, err => {
        if (err) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            fastify.log.info('Device data deleted');
            reply.code(200).send();
        }
    });
});

fastify.listen({port: 9001, host: '::'}, (err) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});

function transformRow(row: Record): FormattedRecord {
    return {
        id: row.id,
        id_formatted: row.id.toString(16).toUpperCase().padStart(12, '0').match(/.{1,2}/g).join(':'),
        time: new Date(row.time),
        temperature: row.temperature,
        humidity: row.humidity
    }
}
