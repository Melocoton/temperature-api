import Fastify from 'fastify';
import cors from '@fastify/cors';
import sqlite3 from "sqlite3";
import 'dotenv/config';
import savitzkyGolay, {Options} from "ml-savitzky-golay";

type Record = { id: number, time: number, temperature: number, humidity: number };
type RecordFormatted = { id: number, id_formatted: string, time: number, time_formatted: Date, temperature: number, humidity: number };
type RecordSimplified = { time: number, temperature: number, humidity: number };
type Device = { id: number, description: string };

const fastify = Fastify({logger: true});
fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
});
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
    db.get('SELECT id, max(time) AS time, temperature, humidity FROM temperature WHERE id = $id GROUP BY id', { $id: id }, (err, row: Record) => {
        if (err || !row) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(transformRow(row));
        }
    });
});

fastify.get('/history/:id', (request, reply) => {
    type Body = {rangeStart: number, rangeEnd: number, smooth: boolean};
    const params = request.query as {rangeStart: string, rangeEnd: string, smooth: string};
    const body: Body = {
        rangeStart: Number(params.rangeStart),
        rangeEnd: Number(params.rangeEnd),
        smooth: params.smooth === 'true'
    };
    const id = Number((request.params as { id: string }).id);

    if (body.rangeStart === body.rangeEnd) {
        reply.code(500).send('La fecha inicial no puede ser igual a la fecha final');
        return;
    }
    db.all('SELECT time, temperature, humidity FROM temperature WHERE id = $id AND time BETWEEN $rangeStart AND $rangeEnd', {
        $id: id,
        $rangeStart: body.rangeStart,
        $rangeEnd: body.rangeEnd
    }, (err, rows: RecordSimplified[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            if (body.smooth) {
                const options: Partial<Options> = {derivative: 0, windowSize: 29, pad: 'post', padValue: "replicate"};
                const ansT = savitzkyGolay(rows.map(r => r.temperature), 1, options);
                const ansH = savitzkyGolay(rows.map(r => r.humidity), 1, options);
                rows.forEach((row, index) => {
                    row.temperature = Number(ansT[index].toPrecision(4));
                    row.humidity = Number(ansH[index].toPrecision(4));
                });
            }
            reply.send(rows);
        }
    });
});

fastify.get('/current/:id/:rangeStart-:rangeEnd', (request, reply) => {
    const { id, rangeStart, rangeEnd} = objStrNum(request.params as object) as {id: number, rangeStart: number, rangeEnd: number};
    db.all('SELECT time, temperature, humidity FROM temperature WHERE id = $id AND time BETWEEN $rangeStart AND $rangeEnd', {
        $id: id,
        $rangeStart: rangeStart,
        $rangeEnd: rangeEnd
    }, (err, rows: RecordSimplified[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(rows);
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

function transformRow(row: Record): RecordFormatted {
    return {
        id: row.id,
        id_formatted: row.id.toString(16).toUpperCase().padStart(12, '0').match(/.{1,2}/g).join(':'),
        time: row.time,
        time_formatted: new Date(row.time),
        temperature: row.temperature,
        humidity: row.humidity
    }
}

function objStrNum(object: object): object {
    return Object.keys(object).reduce((a, key) => ({ ...a, [key]: Number(object[key])}), {});
}
