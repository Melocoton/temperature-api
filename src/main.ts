import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt'
import sqlite3 from "sqlite3";
import 'dotenv/config';
import savitzkyGolay, {Options} from "ml-savitzky-golay";

type Record = { id: number, time: number, temperature: number, humidity: number };
type RecordFormatted = { id: number, id_formatted: string, time: number, time_formatted: Date, temperature: number, humidity: number };
type RecordSimplified = { time: number, temperature: number, humidity: number };
type Device = { id: number, description: string };
type AuthKey = { key: string };
type TokenClaims = { isAdmin: boolean, iat: number, exp: number };

const fastify = Fastify({logger: true});
fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
});
fastify.register(jwt, {
    secret: process.env.JWT_KEY
});
fastify.decorate("auth", async (request, reply) => {
    try {
        return await request.jwtVerify();
    } catch (e) {
        reply.code(401).send("Unable to get current user verification");
    }
});
fastify.decorate("authAdmin", async (request, reply) => {
    try {
        const decodedToken: TokenClaims = await request.jwtVerify();
        if (decodedToken.isAdmin) {
            return decodedToken;
        } else {
            reply.code(401).send("Admin required");
        }
    } catch (e) {
        reply.code(401).send("Unable to get current user verification");
    }
});
const db = new sqlite3.Database(process.env.DB_LOCATION,sqlite3.OPEN_READWRITE, err => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
});

fastify.post('/auth', (request, reply) => {
    const body = request.body as AuthKey;
    if (body.key === process.env.AUTH_KEY) {
        const token = fastify.jwt.sign({isAdmin: false}, {expiresIn: "24h"});
        reply.send({token});
    } else if (body.key === process.env.ADMIN_KEY) {
        const token = fastify.jwt.sign({isAdmin: true}, {expiresIn: "24h"});
        reply.send({token});
    } else {
        reply.code(401).send("Unauthorized");
    }

});

fastify.get('/', (request, reply) => {
    reply.send('Hello World');
});

fastify.get('/current', {onRequest: [fastify["auth"]]}, (request, reply) => {
    db.all('SELECT id, max(time) AS time, temperature, humidity FROM (SELECT * FROM temperature ORDER BY time DESC LIMIT 20000) WHERE id IN (SELECT id FROM device) GROUP BY id', (err, rows: Record[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(rows.map(transformRow));
        }
    });
});

fastify.get('/current/:id', {onRequest: [fastify["auth"]]}, (request, reply) => {
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

fastify.get('/history/:id', {onRequest: [fastify["auth"]]}, (request, reply) => {
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
            rows = compress(rows, Math.round(rows.length / 20));
            if (body.smooth) {
                try {
                    const options: Partial<Options> = {
                        derivative: 0,
                        windowSize: 5,
                        pad: 'post',
                        padValue: "replicate"
                    };
                    const ansT = savitzkyGolay(rows.map(r => r.temperature), 1, options);
                    const ansH = savitzkyGolay(rows.map(r => r.humidity), 1, options);
                    rows.forEach((row, index) => {
                        row.temperature = Number(ansT[index].toPrecision(4));
                        row.humidity = Number(ansH[index].toPrecision(4));
                    });
                } catch (e) {
                    reply.send(rows);
                }
            }
            reply.send(rows);
        }
    });
});

fastify.get('/current/:id/:rangeStart-:rangeEnd', {onRequest: [fastify["auth"]]}, (request, reply) => {
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

fastify.get('/devices', {onRequest: [fastify["auth"]]}, (request, reply) => {
    db.all('SELECT * FROM device;', (err, rows: Device[]) => {
        if (err || !rows) {
            fastify.log.error(err);
            reply.code(500).send(err);
        } else {
            reply.send(rows);
        }
    });
});

fastify.get('/device/:id', {onRequest: [fastify["auth"]]}, (request, reply) => {
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

fastify.put('/device', {onRequest: [fastify["authAdmin"]]}, (request, reply) => {
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

fastify.patch('/device', {onRequest: [fastify["authAdmin"]]}, (request, reply) => {
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

fastify.delete('/device/:id', {onRequest: [fastify["authAdmin"]]}, (request, reply) => {
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

function compress(data: RecordSimplified[], size = 100): RecordSimplified[] {
    const chunkSize: number = data.length / size;
    const chunkArray: RecordSimplified[][] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        chunkArray.push(chunk);
    }
    const compressedData = chunkArray.map(chunk => {
        const avgchunk = chunk.reduce((acc, cur) => sumRecord(acc, cur));
        const finalCalculation: RecordSimplified = {
            humidity: avgchunk.humidity / chunk.length,
            temperature: avgchunk.temperature / chunk.length,
            time: avgchunk.time
        };
        return finalCalculation;
    });
    return compressedData;
}

function sumRecord(recordA: RecordSimplified, recordB: RecordSimplified): RecordSimplified {
    return {
        humidity: recordA.humidity + recordB.humidity,
        temperature: recordA.temperature + recordB.temperature,
        time: recordA.time,
    }
}
